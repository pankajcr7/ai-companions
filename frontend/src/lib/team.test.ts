import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, ConnectionSummary, Department } from "./types.ts";
import { canGiveTask, groupTeam, isReady, roleLabel, setupSteps, statusText, teamStatus, workingTasks } from "./team.ts";

const look = { style: "robot", color: "#000000", head: "round", eyes: "dots", accessory: "none" } as Agent["appearance"];
const agent = (o: Partial<Agent>): Agent => ({ id: "a", name: "A", role: "Writer", kind: "ai", workingStyle: "", status: "active", isHead: false, departmentId: null, managerId: null, appearance: look, connectionId: "c1", model: "m", ...o });
const conns: ConnectionSummary[] = [{ id: "c1", kind: "custom", label: "Fake", hint: "x", status: "connected" }];

test("the head's default role reads as Team lead; a renamed role stays", () => {
  assert.equal(roleLabel({ isHead: true, role: "Head agent" }), "Team lead");
  assert.equal(roleLabel({ isHead: true, role: "Chief of staff" }), "Chief of staff");
  assert.equal(roleLabel({ isHead: false, role: "Head agent" }), "Head agent");
});

test("ready means an AI model on a connected service; humans are always ready", () => {
  assert.equal(isReady(agent({}), conns), true);
  assert.equal(isReady(agent({ model: null }), conns), false);
  assert.equal(isReady(agent({ connectionId: "gone" }), conns), false);
  assert.equal(isReady(agent({}), [{ ...conns[0], status: "reauth" }]), false);
  assert.equal(isReady(agent({ kind: "human", model: null, connectionId: null }), conns), true);
});

test("status: former, paused, working, free, needs setup", () => {
  const working = workingTasks({ tasks: [{ agentId: "a", title: "Write posts", status: "running" }, { agentId: "b", title: "Done one", status: "done" }] as never });
  assert.deepEqual([...working], [["a", "Write posts"]]);
  assert.deepEqual(teamStatus(agent({ status: "archived" }), conns, working), { kind: "former" });
  assert.deepEqual(teamStatus(agent({ status: "paused" }), conns, working), { kind: "paused" });
  assert.deepEqual(teamStatus(agent({}), conns, working), { kind: "working", task: "Write posts" });
  assert.deepEqual(teamStatus(agent({ id: "b" }), conns, working), { kind: "free" });
  assert.deepEqual(teamStatus(agent({ id: "b", model: null }), conns, working), { kind: "setup" });
  assert.equal(statusText({ kind: "working", task: "Write posts" }), "Working on: Write posts");
  assert.equal(statusText({ kind: "setup" }), "Needs setup");
  assert.equal(workingTasks(null).size, 0);
});

test("grouping: lead first, departments in order, then no department; former apart; empty groups dropped", () => {
  const depts: Department[] = [{ id: "d2", name: "Sales", sortOrder: 2 }, { id: "d1", name: "Design", sortOrder: 1 }, { id: "d3", name: "Empty", sortOrder: 3 }];
  const team = [agent({ id: "h", isHead: true, departmentId: "d1" }), agent({ id: "s", departmentId: "d2" }), agent({ id: "x", departmentId: "d1" }), agent({ id: "n" }), agent({ id: "lost", departmentId: "deleted" }), agent({ id: "old", status: "archived" })];
  const { groups, former } = groupTeam(team, depts);
  assert.deepEqual(groups.map((g) => [g.name, g.agents.map((a) => a.id)]), [["Team lead", ["h"]], ["Design", ["x"]], ["Sales", ["s"]], ["No department", ["n", "lost"]]]);
  assert.deepEqual(former.map((a) => a.id), ["old"]);
});

test("only members and admins can give tasks, and only to current teammates", () => {
  assert.equal(canGiveTask("owner", agent({})), true);
  assert.equal(canGiveTask("viewer", agent({})), false);
  assert.equal(canGiveTask("member", agent({ status: "archived" })), false);
});

test("setup steps: a connected service, then the head's model on it", () => {
  const head = agent({ isHead: true, model: null, connectionId: null });
  assert.deepEqual(setupSteps([head], []), { service: false, model: false, done: false });
  assert.deepEqual(setupSteps([head], conns), { service: true, model: false, done: false });
  assert.deepEqual(setupSteps([{ ...head, model: "m", connectionId: "c1" }], conns), { service: true, model: true, done: true });
  assert.deepEqual(setupSteps([{ ...head, model: "m", connectionId: "c1" }], [{ ...conns[0], status: "error" }]), { service: false, model: false, done: false });
});
