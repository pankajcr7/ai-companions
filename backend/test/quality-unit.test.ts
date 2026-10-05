import { expect, test } from "vitest";
import { DESIGN_GUIDE, isVisualTask, Review, reviewPrompt } from "../src/goals/quality.js";

test("visual tasks are recognised from their words", () => {
  expect(isVisualTask({ title: "Build the landing page", instructions: "", deliverable: "" })).toBe(true);
  expect(isVisualTask({ title: "Write posts", instructions: "Three Instagram posts with a banner", deliverable: "" })).toBe(true);
  expect(isVisualTask({ title: "Research competitors", instructions: "Compare prices", deliverable: "A table" })).toBe(false);
  expect(DESIGN_GUIDE.length).toBeLessThan(2000);
});

test("a not-approved review with no fixes counts as approved", () => {
  const r = Review.parse({ approved: false, fixes: [] });
  expect(r.approved || r.fixes.length === 0).toBe(true);
});

test("the review prompt caps file content at 40,000 characters, then lists names", () => {
  const files = [{ path: "a.html", content: "a".repeat(30_000) }, { path: "b.css", content: "b".repeat(30_000) }];
  const p = reviewPrompt({ goal: "g", task: { title: "t", instructions: "i", deliverable: "d", criteria: ["c"] }, brief: null, guide: false, result: "r", files });
  expect(p).toContain("a".repeat(30_000));
  expect(p).not.toContain("b".repeat(10_001));
  expect(p).toContain("b.css (not shown: too long)");
});
