import assert from "node:assert/strict";
import { test } from "node:test";
import { fitWithin, needsViewCopy, pastedName, refusal } from "./attachments.ts";

test("big images get a viewing copy that fits within 2,000 px", () => {
  assert.deepEqual(fitWithin(4000, 3000), { w: 2000, h: 1500 });
  assert.deepEqual(fitWithin(1000, 3000), { w: 667, h: 2000 });
  assert.deepEqual(fitWithin(800, 600), { w: 800, h: 600 });
  assert.equal(needsViewCopy(5 * 1024 * 1024, 1000, 800), true);
  assert.equal(needsViewCopy(200_000, 2400, 1000), true);
  assert.equal(needsViewCopy(200_000, 1200, 900), false);
});

test("files over 10 MB are refused with their name", () => {
  assert.equal(refusal({ name: "menu.pdf", size: 10 * 1024 * 1024 + 1 }), "menu.pdf is over 10 MB");
  assert.equal(refusal({ name: "ok.png", size: 1000 }), null);
});

test("pasted images get their own names, so each can be found again", () => {
  const when = new Date(2026, 9, 9, 14, 5, 7);
  assert.equal(pastedName({ name: "image.png", type: "image/png" }, when, 0), "screenshot-2026-10-09-140507.png");
  assert.equal(pastedName({ name: "image.png", type: "image/png" }, when, 1), "screenshot-2026-10-09-140507-2.png");
  assert.equal(pastedName({ name: "", type: "image/jpeg" }, when, 0), "screenshot-2026-10-09-140507.jpg");
  assert.equal(pastedName({ name: "menu.pdf", type: "application/pdf" }, when, 0), "menu.pdf");
});
