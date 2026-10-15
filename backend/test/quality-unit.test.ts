import { expect, test } from "vitest";
import { planInstructions } from "../src/goals/prompts.js";
import { DESIGN_GUIDE, isVisualTask, Review, reviewPrompt } from "../src/goals/quality.js";

test("visual tasks are recognised from their words", () => {
  expect(isVisualTask({ title: "Build the landing page", instructions: "", deliverable: "" })).toBe(true);
  expect(isVisualTask({ title: "Write posts", instructions: "Three Instagram posts with a banner", deliverable: "" })).toBe(true);
  expect(isVisualTask({ title: "Research competitors", instructions: "Compare prices", deliverable: "A table" })).toBe(false);
  expect(DESIGN_GUIDE.length).toBeLessThan(2000);
});

test("planning and visual tasks look at a website the owner wants matched", () => {
  expect(planInstructions("Co", false)).toContain("If the goal names a website to match, look at it with look_at_website before planning");
  expect(DESIGN_GUIDE).toContain("If the goal, brief or task gives a website to match, look at it with look_at_website first");
  expect(DESIGN_GUIDE.length).toBeLessThan(2000);
});

test("an image the owner asks for is made with generate_image, not drawn in code", () => {
  expect(DESIGN_GUIDE).toContain("When the deliverable is itself an image (a post, ad, poster, banner or illustration), make it with generate_image");
  expect(DESIGN_GUIDE).toContain("never draw it as SVG or HTML code");
  expect(DESIGN_GUIDE.length).toBeLessThan(2000);
  expect(planInstructions("Co", false, true)).toContain("The team can make images with generate_image");
  expect(planInstructions("Co", false)).not.toContain("generate_image");
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
