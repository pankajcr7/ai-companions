import type { ServerResponse } from "node:http";
import sharp from "sharp";
import { afterAll, beforeEach, expect, test } from "vitest";
import { IMAGE_TIMEOUT_MS, imageTool, slug, type ImageKeys, type ImageSource, type MediaStore } from "../src/harness/images.js";
import { ToolError, type ToolOutput } from "../src/harness/loop.js";
import { fakeServer, json, type FakeRequest } from "./fake-provider.js";

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#c96" } }).png().toBuffer();
const PNG = await png(8, 8);
const B64 = PNG.toString("base64");
const CF_PATH = "POST /accounts/acc123/ai/run/@cf/black-forest-labs/flux-2-klein-4b";
const cf = await fakeServer({});
const pol = await fakeServer({});
process.env.TEST_CLOUDFLARE_BASE_URL = cf.url;
process.env.TEST_POLLINATIONS_BASE_URL = pol.url;
afterAll(async () => {
  await cf.close();
  await pol.close();
});
beforeEach(() => {
  for (const s of [cf, pol]) {
    s.requests.length = 0;
    for (const k of Object.keys(s.routes)) delete s.routes[k];
  }
});

const CF_KEY = { accountId: "acc123", apiToken: "cf-token" };
const both: ImageKeys = { cloudflare: CF_KEY, pollinations: "sk_pol" };
const cfOnly: ImageKeys = { cloudflare: CF_KEY, pollinations: null };
const cfImage = (data: Buffer) => (_q: FakeRequest, res: ServerResponse) => json(res, 200, { success: true, result: { image: data.toString("base64") } });
const polOk = (_q: FakeRequest, res: ServerResponse) => json(res, 200, { data: [{ b64_json: B64 }] });
const formOf = (q: FakeRequest) => new Response(new Uint8Array(q.bytes), { headers: { "content-type": String(q.headers["content-type"]) } }).formData();
const sizeOf = async (f: FormDataEntryValue | null) => sharp(Buffer.from(await (f as File).arrayBuffer())).metadata();

function store() {
  const saved: string[] = [];
  const media: MediaStore = { save: async (_d, name) => (saved.push(name), `Saved as images/${name}`) };
  return { saved, media };
}
const noSource: ImageSource = async (name) => {
  throw new ToolError(`There's no image called ${name}. Use list_attachments or list_files to see them.`);
};
async function make(keys: ImageKeys, args: object, o: { media?: MediaStore; source?: ImageSource } = {}) {
  const tool = imageTool(keys, o.media ?? store().media, o.source ?? noSource)!;
  return (await tool.run(tool.args.parse(args), new AbortController().signal)) as ToolOutput;
}

test("standard images come from free Cloudflare and come back as a picture with the cost note", async () => {
  cf.routes[CF_PATH] = cfImage(PNG);
  const { saved, media } = store();
  const out = await make(both, { prompt: "A warm bakery logo with wheat", name: "logo" }, { media });
  expect(out).toEqual({ text: "Saved as images/logo.png (Cloudflare, free).", note: "free", images: [{ mime: "image/png", data: B64 }] });
  expect(saved).toEqual(["logo.png"]);
  expect(pol.requests).toHaveLength(0);
  expect(cf.requests[0].headers.authorization).toBe("Bearer cf-token");
  const form = await formOf(cf.requests[0]);
  expect([form.get("prompt"), form.get("width"), form.get("height")]).toEqual(["A warm bakery logo with wheat", "1024", "1024"]);
});

test("a JPEG from Cloudflare is saved as .jpg", async () => {
  const jpeg = await sharp(PNG).jpeg().toBuffer();
  cf.routes[CF_PATH] = cfImage(jpeg);
  const { saved, media } = store();
  const out = await make(cfOnly, { prompt: "Bread" }, { media });
  expect(saved).toEqual(["bread.jpg"]);
  expect(out.images[0].mime).toBe("image/jpeg");
});

test("high quality goes to Pollinations gpt-image-2; without Pollinations it falls back to Cloudflare with a caveat", async () => {
  pol.routes["POST /v1/images/generations"] = polOk;
  cf.routes[CF_PATH] = cfImage(PNG);
  const high = await make(both, { prompt: "Poster that says OPEN", quality: "high", size: "portrait" });
  expect(high).toMatchObject({ text: "Saved as images/poster-that-says-open.png (Pollinations, ~$0.05).", note: "~$0.05" });
  expect(pol.requests[0].body).toMatchObject({ model: "openai/gpt-image-2", prompt: "Poster that says OPEN", size: "1024x1536", quality: "medium", response_format: "b64_json" });
  expect(pol.requests[0].headers.authorization).toBe("Bearer sk_pol");
  const free = await make(cfOnly, { prompt: "Poster that says OPEN", quality: "high" });
  expect(free.text).toBe("Saved as images/poster-that-says-open.png (Cloudflare, free). Made with the free service, so text in this image may be less accurate.");
});

test("when Cloudflare's free images are used up, standard images fall back to Pollinations klein; with no Pollinations key the owner hears when they return", async () => {
  cf.routes[CF_PATH] = (_q, res) => json(res, 429, { success: false, errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }] });
  pol.routes["POST /v1/images/generations"] = polOk;
  const out = await make(both, { prompt: "Bread", size: "landscape" });
  expect(out).toMatchObject({ text: "Saved as images/bread.png (Pollinations, ~$0.005).", note: "~$0.005" });
  expect(pol.requests[0].body).toMatchObject({ model: "black-forest-labs/flux.2-klein-4b", size: "1536x1024" });
  await expect(make(cfOnly, { prompt: "Bread" })).rejects.toThrow("Today's free images are used up; they come back at 00:00 UTC.");
});

test("a rejected key says where to fix it; a refused description doesn't fall back", async () => {
  cf.routes[CF_PATH] = (_q, res) => json(res, 401, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
  await expect(make(cfOnly, { prompt: "Bread" })).rejects.toThrow("The Cloudflare key was rejected. Update it in Settings › AI services.");
  cf.routes[CF_PATH] = (_q, res) => json(res, 400, { success: false, errors: [{ code: 3030, message: "flagged" }] });
  pol.routes["POST /v1/images/generations"] = polOk;
  await expect(make(both, { prompt: "Bread" })).rejects.toThrow("The image service refused this description. Try different wording.");
  expect(pol.requests).toHaveLength(0);
});

test("at most 4 images per reply", async () => {
  cf.routes[CF_PATH] = cfImage(PNG);
  const tool = imageTool(cfOnly, store().media, noSource)!;
  for (let i = 0; i < 4; i++) await tool.run(tool.args.parse({ prompt: `Bread ${i}` }), new AbortController().signal);
  await expect(tool.run(tool.args.parse({ prompt: "Bread 5" }), new AbortController().signal)).rejects.toThrow("That's 4 images for this reply, the limit. Finish with what you have.");
  expect(cf.requests).toHaveLength(4);
});

test("edits shrink their inputs: under 512 px for Cloudflare, within 1536 px for Pollinations", async () => {
  const big = await png(2000, 1000);
  const source: ImageSource = async (name) => (name === "cake.png" ? big : noSource(name));
  cf.routes[CF_PATH] = cfImage(PNG);
  await make(cfOnly, { prompt: "Put image 1 on marble next to image 2", from: ["cake.png", "cake.png"] }, { source });
  const form = await formOf(cf.requests[0]);
  for (const field of ["input_image_0", "input_image_1"]) {
    const meta = await sizeOf(form.get(field));
    expect(meta.width).toBe(511);
    expect(meta.height!).toBeLessThan(512);
  }
  pol.routes["POST /v1/images/edits"] = polOk;
  await make({ cloudflare: null, pollinations: "sk_pol" }, { prompt: "Put image 1 on marble", from: ["cake.png"] }, { source });
  const pform = await formOf(pol.requests[0]);
  const meta = await sizeOf(pform.getAll("image")[0]);
  expect([meta.width, meta.height]).toEqual([1536, 768]);
  expect([pform.get("model"), pform.get("prompt")]).toEqual(["black-forest-labs/flux.2-klein-4b", "Put image 1 on marble"]);
  await expect(make(cfOnly, { prompt: "x", from: ["nope.png"] }, { source })).rejects.toThrow("There's no image called nope.png. Use list_attachments or list_files to see them.");
});

test("cancelling stops the request and saves nothing", async () => {
  cf.routes[CF_PATH] = () => new Promise<void>(() => {});
  const { saved, media } = store();
  const tool = imageTool(cfOnly, media, noSource)!;
  const c = new AbortController();
  const pending = tool.run(tool.args.parse({ prompt: "Bread" }), c.signal);
  setTimeout(() => c.abort(), 100);
  await expect(pending).rejects.toThrow();
  expect(saved).toEqual([]);
});

test("no keys, no tool; a 2-minute limit; names come from the prompt's first five words", () => {
  expect(imageTool({ cloudflare: null, pollinations: null }, store().media, noSource)).toBeNull();
  expect(imageTool(cfOnly, store().media, noSource)!.timeoutMs).toBe(IMAGE_TIMEOUT_MS);
  expect(IMAGE_TIMEOUT_MS).toBe(120_000);
  expect(slug("A Warm bakery logo, with wheat & sun!")).toBe("a-warm-bakery-logo-with");
  expect(slug("ताज़ी रोटी")).toBe("image");
});
