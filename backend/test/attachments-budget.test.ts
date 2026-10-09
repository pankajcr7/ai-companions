import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { historyTurns, imageFits, MAX_IMAGE_BYTES } from "../src/attachments/parts.js";
import { putBlob } from "../src/files/store.js";
import type { Attachment } from "../src/generated/prisma/client.js";
import { complete, type Actor } from "../src/goals/llm.js";
import { fakeServer, json, sse } from "./fake-provider.js";

process.env.FILES_DIR = mkdtempSync(join(tmpdir(), "blobs-"));
let n = 0;
async function att(over: Partial<Attachment> & { bytes: number }): Promise<Attachment> {
  const { bytes, ...rest } = over;
  const blobHash = await putBlob(Buffer.alloc(bytes, ++n));
  return { id: `a${n}`, workspaceId: "w", userId: "u", messageId: null, goalMessageId: null, goalId: null, name: `f${n}`, mime: "image/png", kind: "image", size: bytes, blobHash, viewHash: null, viewMime: null, text: null, pages: null, scanned: false, createdAt: new Date(), ...rest };
}
const kinds = (turn: { content: unknown }) => (Array.isArray(turn.content) ? (turn.content as { type: string }[]).map((p) => p.type) : ["string"]);

test("native PDFs go only with the newest message, and only when small and short", async () => {
  const old = await att({ kind: "pdf", mime: "application/pdf", name: "old.pdf", bytes: 1000, text: "old menu", pages: 2 });
  const fresh = await att({ kind: "pdf", mime: "application/pdf", name: "new.pdf", bytes: 1000, text: "new menu", pages: 2 });
  const huge = await att({ kind: "pdf", mime: "application/pdf", name: "huge.pdf", bytes: 6 * 1024 * 1024, text: "big", pages: 3 });
  const long = await att({ kind: "pdf", mime: "application/pdf", name: "long.pdf", bytes: 1000, text: "long", pages: 150 });
  const turns = await historyTurns(
    [
      { role: "user", content: "first", attachments: [old] },
      { role: "assistant", content: "ok", attachments: [] },
      { role: "user", content: "second", attachments: [fresh, huge, long] },
    ],
    "anthropic",
  );
  expect(kinds(turns[0])).toEqual(["text", "text"]);
  expect(kinds(turns[2]).filter((k) => k === "pdf")).toHaveLength(1);
  expect(JSON.stringify(turns[2].content)).toContain("new menu");
});

test("pictures stay within a per-request budget, newest first; one too big to send becomes a note", async () => {
  const pics = await Promise.all([1, 2, 3, 4].map(() => att({ bytes: 3_500_000 })));
  const tooBig = await att({ name: "poster.png", bytes: MAX_IMAGE_BYTES + 1 });
  const turns = await historyTurns(
    [
      { role: "user", content: "a", attachments: [pics[0]] },
      { role: "user", content: "b", attachments: [pics[1], pics[2], pics[3], tooBig] },
    ],
    "openai",
  );
  const images = turns.flatMap(kinds).filter((k) => k === "image");
  expect(images).toHaveLength(3);
  expect(JSON.stringify(turns[1].content)).toContain("poster.png — too large to show");
  expect(imageFits(MAX_IMAGE_BYTES)).toBe(true);
  expect(imageFits(MAX_IMAGE_BYTES + 1)).toBe(false);
});

const fake = await fakeServer({});
afterAll(() => fake.close());
const actor: Actor = { id: "a", name: "A", kind: "ai", status: "active", model: "m", connection: { id: "c", kind: "custom", baseUrl: `${fake.url}/v1`, secret: null, status: "connected" } };

test("a request that is simply too big is not mistaken for a model that can't see", async () => {
  fake.routes["POST /v1/chat/completions"] = (_q, res) => json(res, 413, { error: { message: "request too large" } });
  const before = fake.requests.length;
  await expect(complete(actor, "x", [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image", mime: "image/png", data: "AAAA" }] }], AbortSignal.timeout(20_000))).rejects.toMatchObject({ code: "bad_request" });
  expect(fake.requests.length - before).toBe(1);
});

test("when only PDFs had to be dropped, the reply isn't flagged as 'can't see images'", async () => {
  let calls = 0;
  fake.routes["POST /v1/chat/completions"] = (_q, res) => (++calls === 1 ? json(res, 400, { error: { message: "unsupported input" } }) : sse(res, [JSON.stringify({ choices: [{ delta: { content: "ok" } }] }), "[DONE]"]));
  const call = await complete(actor, "x", [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "pdf", name: "a.pdf", data: "JVBE" }] }], AbortSignal.timeout(20_000));
  expect(call.text).toBe("ok");
  expect(call.visionFallback).toBeFalsy();
});
