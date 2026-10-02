import { expect, test } from "vitest";
import { createsCycle } from "../src/org.js";

const chain = new Map<string, string | null>([
  ["head", null],
  ["em", "head"],
  ["dev", "em"],
]);

test("making yourself your own manager is a cycle", () => {
  expect(createsCycle("dev", "dev", chain)).toBe(true);
});

test("making a manager report to their own report is a cycle", () => {
  expect(createsCycle("em", "dev", chain)).toBe(true);
  expect(createsCycle("head", "dev", chain)).toBe(true);
});

test("normal reassignments are fine", () => {
  expect(createsCycle("dev", "head", chain)).toBe(false);
});

test("a pre-existing loop in data does not hang", () => {
  const broken = new Map<string, string | null>([["x", "y"], ["y", "x"], ["z", null]]);
  expect(createsCycle("z", "x", broken)).toBe(true);
});
