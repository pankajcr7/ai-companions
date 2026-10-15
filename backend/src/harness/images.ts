import sharp from "sharp";
import { z } from "zod";
import { detect } from "../attachments/detect.js";
import { imageFits } from "../attachments/parts.js";
import { decryptSecret } from "../crypto.js";
import { prisma } from "../db.js";
import { testOverride } from "../env.js";
import { ToolError, type Tool } from "./loop.js";

export type CloudflareKey = { accountId: string; apiToken: string };
export type ImageKeys = { cloudflare: CloudflareKey | null; pollinations: string | null };
/** Where a made image goes; returns the start of the result sentence ("Saved as images/hero.png"). */
export type MediaStore = { save(data: Buffer, fileName: string): Promise<string> };
/** The bytes of an image named in `from`; throws a ToolError when there is none. */
export type ImageSource = (name: string) => Promise<Buffer>;

export const MAX_IMAGES = 4;
export const IMAGE_TIMEOUT_MS = 120_000;
const SIZES = { square: [1024, 1024], landscape: [1536, 1024], portrait: [1024, 1536] } as const;
type Size = (typeof SIZES)[keyof typeof SIZES];
// FLUX.2 klein 9B: clearly better than 4B (and at words) but ~9x the free daily allowance: ~6-7 images a day, not ~64.
const CF_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
const POL_STANDARD = "black-forest-labs/flux.2-klein-4b";
const POL_HIGH = "openai/gpt-image-2";
// ponytail: fixed prices as of 2026-10; update when the services change them.
const COST = { cloudflare: "free", polStandard: "~$0.005", polHigh: "~$0.05" };
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

const cfBase = () => testOverride("TEST_CLOUDFLARE_BASE_URL") ?? "https://api.cloudflare.com/client/v4";
const polBase = () => testOverride("TEST_POLLINATIONS_BASE_URL") ?? "https://gen.pollinations.ai";

type Failure = "used_up" | "rejected" | "refused" | "failed";
class ImageServiceError extends Error {
  constructor(
    readonly kind: Failure,
    message: string,
  ) {
    super(message);
  }
}
const rejected = (service: string) => new ImageServiceError("rejected", `The ${service} key was rejected. Update it in Settings › AI services.`);
const refused = () => new ImageServiceError("refused", "The image service refused this description. Try different wording.");

function cloudflareError(status: number, message: string) {
  if (status === 401 || status === 403 || status === 404) return rejected("Cloudflare");
  if (status === 429 || /daily free allocation|\b4006\b/i.test(message)) return new ImageServiceError("used_up", "Today's free images are used up; they come back at 00:00 UTC.");
  if (status >= 400 && status < 500) return refused();
  return new ImageServiceError("failed", `Cloudflare isn't working right now (${status}). Try again in a minute.`);
}

function pollinationsError(status: number) {
  if (status === 401 || status === 403) return rejected("Pollinations");
  if (status === 402) return new ImageServiceError("used_up", "The Pollinations balance is used up. Top it up at enter.pollinations.ai.");
  if (status === 429) return new ImageServiceError("failed", "Pollinations is busy right now. Try again in a minute.");
  if (status >= 400 && status < 500) return refused();
  return new ImageServiceError("failed", `Pollinations isn't working right now (${status}). Try again in a minute.`);
}

/** Fits an image inside max×max as PNG, never enlarging it. */
export const shrink = (data: Buffer, max: number) => sharp(data, { animated: false }).resize(max, max, { fit: "inside", withoutEnlargement: true }).png().toBuffer();

const blob = (data: Buffer) => new Blob([new Uint8Array(data)], { type: "image/png" });

async function cloudflareImage(key: CloudflareKey, prompt: string, size: Size, inputs: Buffer[], signal: AbortSignal): Promise<Buffer> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(size[0]));
  form.append("height", String(size[1]));
  // Cloudflare takes at most 4 inputs, each under 512×512.
  (await Promise.all(inputs.map((d) => shrink(d, 511)))).forEach((d, i) => form.append(`input_image_${i}`, blob(d), `image-${i}.png`));
  const res = await fetch(`${cfBase()}/accounts/${encodeURIComponent(key.accountId)}/ai/run/${CF_MODEL}`, { method: "POST", headers: { authorization: `Bearer ${key.apiToken}` }, body: form, signal });
  const body = (await res.json().catch(() => null)) as { result?: { image?: string }; errors?: { code?: number; message?: string }[] } | null;
  if (res.ok && body?.result?.image) return Buffer.from(body.result.image, "base64");
  throw cloudflareError(res.status, (body?.errors ?? []).map((e) => `${e.code ?? ""} ${e.message ?? ""}`).join(" "));
}

async function pollinationsImage(key: string, model: string, prompt: string, size: Size, inputs: Buffer[], signal: AbortSignal): Promise<Buffer> {
  const fields = { model, prompt, size: `${size[0]}x${size[1]}`, quality: "medium", response_format: "b64_json" };
  const auth = { authorization: `Bearer ${key}` };
  let res: Response;
  if (!inputs.length) res = await fetch(`${polBase()}/v1/images/generations`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(fields), signal });
  else {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    (await Promise.all(inputs.map((d) => shrink(d, 1536)))).forEach((d, i) => form.append("image", blob(d), `image-${i}.png`));
    res = await fetch(`${polBase()}/v1/images/edits`, { method: "POST", headers: auth, body: form, signal });
  }
  const body = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[] } | null;
  const image = body?.data?.[0]?.b64_json;
  if (res.ok && image) return Buffer.from(image, "base64");
  throw pollinationsError(res.status);
}

/** "A warm bakery logo, with wheat" → "a-warm-bakery-logo-with"; no Latin letters → "image". */
export const slug = (prompt: string) => prompt.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 5).join("-") || "image";

const Args = z.object({
  prompt: z.string().trim().min(1).max(4000),
  size: z.enum(["square", "landscape", "portrait"]).default("square"),
  quality: z.enum(["standard", "high"]).default("standard"),
  name: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/, "use 1-60 letters, digits, - or _").optional(),
  from: z.array(z.string().min(1).max(300)).max(4).default([]),
});
type ImageArgs = z.infer<typeof Args>;
type Attempt = { service: "Cloudflare" | "Pollinations"; cost: string; make: (inputs: Buffer[], signal: AbortSignal) => Promise<Buffer> };

function attempts(keys: ImageKeys, a: ImageArgs): Attempt[] {
  const size = SIZES[a.size];
  const cf = keys.cloudflare;
  const pk = keys.pollinations;
  const cloudflare: Attempt | null = cf ? { service: "Cloudflare", cost: COST.cloudflare, make: (inputs, signal) => cloudflareImage(cf, a.prompt, size, inputs, signal) } : null;
  const pollinations = (model: string, cost: string): Attempt | null => (pk ? { service: "Pollinations", cost, make: (inputs, signal) => pollinationsImage(pk, model, a.prompt, size, inputs, signal) } : null);
  const order = a.quality === "high" ? [pollinations(POL_HIGH, COST.polHigh), cloudflare] : [cloudflare, pollinations(POL_STANDARD, COST.polStandard)];
  return order.filter((x): x is Attempt => x !== null);
}

/** generate_image: free Cloudflare first, Pollinations for readable text or when Cloudflare can't; at most 4 per reply or task. */
export function imageTool(keys: ImageKeys, media: MediaStore, source: ImageSource): Tool<ImageArgs> | null {
  if (!keys.cloudflare && !keys.pollinations) return null;
  let made = 0;
  return {
    name: "generate_image",
    purpose: `Creates an image from a description, or edits and combines up to 4 existing images named in "from" (call them image 1 to 4 in the prompt, in that order). Use quality "high" only for images that must show readable words (logos, posters, social posts with text) or when the owner asks for high quality: it costs about 5 cents. At most ${MAX_IMAGES} images per reply.`,
    argsHelp: '{"prompt": text, "size"?: "square"|"landscape"|"portrait", "quality"?: "standard"|"high", "name"?: file name without extension, "from"?: [image names]}',
    args: Args,
    label: (a) => `“${a.prompt.length > 40 ? `${a.prompt.slice(0, 40)}…` : a.prompt}”`,
    timeoutMs: IMAGE_TIMEOUT_MS,
    run: async (a, signal) => {
      if (made >= MAX_IMAGES) throw new ToolError(`That's ${MAX_IMAGES} images for this reply, the limit. Finish with what you have.`);
      const inputs = await Promise.all(a.from.map(source));
      const problems: string[] = [];
      for (const at of attempts(keys, a)) {
        let data: Buffer;
        try {
          data = await at.make(inputs, signal);
        } catch (e) {
          if (signal.aborted) throw e;
          if (e instanceof ImageServiceError && e.kind === "refused") throw new ToolError(e.message);
          problems.push(e instanceof ImageServiceError ? e.message : `${at.service} isn't reachable right now.`);
          continue;
        }
        const type = detect("image", data);
        if (type?.kind !== "image") {
          problems.push(`${at.service} sent back something that isn't an image.`);
          continue;
        }
        made++;
        const where = await media.save(data, `${a.name ?? slug(a.prompt)}.${EXT[type.mime]}`);
        const caveat = a.quality === "high" && at.service === "Cloudflare" ? " Made with the free service, so text in this image may be less accurate." : "";
        const text = `${where} (${at.service}, ${at.cost}).${caveat}`;
        return imageFits(data.length) ? { text, images: [{ mime: type.mime, data: data.toString("base64") }], note: at.cost } : { text: `${text} It's too large to show you.`, images: [], note: at.cost };
      }
      throw new ToolError(problems.join(" "));
    },
  };
}

export async function loadImageKeys(workspaceId: string): Promise<ImageKeys> {
  const rows = await prisma.imageKey.findMany({ where: { workspaceId } });
  const secret = (provider: string) => {
    const row = rows.find((r) => r.provider === provider);
    return row ? decryptSecret(row.secret) : null;
  };
  const cf = secret("cloudflare");
  return { cloudflare: cf ? (JSON.parse(cf) as CloudflareKey) : null, pollinations: secret("pollinations") };
}

/** Free checks used when a key is saved: neither makes an image. */
export async function checkCloudflare(key: CloudflareKey, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${cfBase()}/accounts/${encodeURIComponent(key.accountId)}/ai/models/search?per_page=1`, { headers: { authorization: `Bearer ${key.apiToken}` }, signal });
  } catch {
    throw new ToolError("Cloudflare isn't reachable right now. Try again in a minute.");
  }
  if (res.ok) return;
  if (res.status >= 400 && res.status < 500) throw new ToolError("Cloudflare rejected that Account ID or API token. Check both, and that the token can use Workers AI.");
  throw new ToolError(`Cloudflare isn't working right now (${res.status}). Try again in a minute.`);
}

export async function checkPollinations(key: string, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${polBase()}/account/key`, { headers: { authorization: `Bearer ${key}` }, signal });
  } catch {
    throw new ToolError("Pollinations isn't reachable right now. Try again in a minute.");
  }
  const body = (await res.json().catch(() => null)) as { valid?: boolean } | null;
  if (res.ok && body?.valid !== false) return;
  if (res.ok || (res.status >= 400 && res.status < 500)) throw new ToolError("Pollinations rejected that key. Use a secret key (sk_…) from enter.pollinations.ai.");
  throw new ToolError(`Pollinations isn't working right now (${res.status}). Try again in a minute.`);
}
