import { expect, test } from "vitest";
import { autoLayout, UNASSIGNED, type Layout } from "../src/layout.js";

const inside = (l: Layout, agentId: string, deptId: string) => {
  const z = l.zones.find((z) => z.departmentId === deptId)!;
  const d = l.desks[agentId];
  return d.x >= z.x && d.x <= z.x + z.w && d.y >= z.y && d.y <= z.y + z.h;
};

test("every agent gets a desk inside its department zone", () => {
  const agents = [
    { id: "a", departmentId: "d1" },
    { id: "b", departmentId: "d1" },
    { id: "c", departmentId: "d2" },
    { id: "d", departmentId: "d1" },
    { id: "e", departmentId: "d1" },
  ];
  const l = autoLayout(["d1", "d2"], agents);
  expect(l.zones.map((z) => z.departmentId)).toEqual(["d1", "d2"]);
  for (const a of agents) expect(inside(l, a.id, a.departmentId)).toBe(true);
});

test("agents without a known department go to an Unassigned zone", () => {
  const l = autoLayout(["d1"], [{ id: "a", departmentId: null }, { id: "b", departmentId: "gone" }]);
  expect(l.zones.at(-1)!.departmentId).toBe(UNASSIGNED);
  expect(inside(l, "a", UNASSIGNED) && inside(l, "b", UNASSIGNED)).toBe(true);
});

test("a dragged desk is kept when its zone did not move", () => {
  const first = autoLayout(["d1"], [{ id: "a", departmentId: "d1" }]);
  const z = first.zones[0];
  const dragged: Layout = { ...first, desks: { a: { x: z.x + 300, y: z.y + 100 } } };
  const next = autoLayout(["d1"], [{ id: "a", departmentId: "d1" }, { id: "b", departmentId: "d1" }], dragged);
  expect(next.desks.a).toEqual({ x: z.x + 300, y: z.y + 100 });
  expect(next.desks.b).toBeDefined();
});

test("zones wrap after three per row without overlapping", () => {
  const l = autoLayout(["1", "2", "3", "4"], []);
  expect(l.zones[3].y).toBeGreaterThan(l.zones[0].y + l.zones[0].h);
});
