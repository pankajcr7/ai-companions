import { expect, test } from "vitest";
import { cap, pickFiles, projectMap, revisionKey, sharedContext, type ProjectFile } from "../src/goals/context.js";
import { checkEdit, splitEdits } from "../src/goals/edits.js";
import { extractJson, hasCycle, normalizeAssignees, Plan, planProblems } from "../src/goals/plan.js";

const task = (agentId: string, dependsOn: number[] = []) => ({ agentId, title: "T", instructions: "Do it", deliverable: "A note", criteria: ["Clear"], dependsOn });

test("plan schema caps tasks and criteria", () => {
  expect(Plan.safeParse({ tasks: [task("a")] }).success).toBe(true);
  expect(Plan.safeParse({ tasks: Array.from({ length: 7 }, () => task("a")) }).success).toBe(false);
  expect(Plan.safeParse({ tasks: [{ ...task("a"), criteria: [] }] }).success).toBe(false);
  expect(Plan.safeParse({ tasks: [{ ...task("a"), criteria: ["1", "2", "3", "4", "5", "6"] }] }).success).toBe(false);
});

test("plan problems: unknown assignee, bad dependency, cycle", () => {
  const ids = new Set(["a", "b"]);
  expect(planProblems({ tasks: [task("a"), task("b", [0])] }, ids)).toEqual([]);
  expect(planProblems({ tasks: [task("zed")] }, ids)[0]).toMatch(/not on the roster/);
  expect(planProblems({ tasks: [task("a", [0])] }, ids)[0]).toMatch(/dependsOn 0/);
  expect(planProblems({ tasks: [task("a", [3])] }, ids)[0]).toMatch(/dependsOn 3/);
  expect(planProblems({ tasks: [task("a", [1]), task("b", [0])] }, ids)).toEqual(["Tasks depend on each other in a loop"]);
  expect(hasCycle([[], [0], [1]])).toBe(false);
  expect(hasCycle([[2], [0], [1]])).toBe(true);
});

test("extractJson reads the last fenced block or the outer braces", () => {
  expect(extractJson('Sure!\n```json\n{"a":1}\n```\nmore\n```json\n{"b":2}\n```')).toEqual({ b: 2 });
  expect(extractJson('Here: {"tasks": []} done')).toEqual({ tasks: [] });
  expect(() => extractJson("no json here")).toThrow();
});

test("assignee names are mapped to ids", () => {
  const roster = [{ id: "a1", name: "Nova" }, { id: "b2", name: "Sana" }];
  expect(normalizeAssignees({ tasks: [{ agentId: "sana" }, { agentId: "a1" }, { agentId: "Ghost" }] }, roster)).toEqual({ tasks: [{ agentId: "b2" }, { agentId: "a1" }, { agentId: "Ghost" }] });
  expect(normalizeAssignees("junk", roster)).toBe("junk");
});

test("project map lists files and summarizes the overflow by folder", () => {
  const entries = [
    { path: "src", kind: "dir" as const, size: 0, isText: false },
    { path: "src/a.ts", kind: "file" as const, size: 10, isText: true },
    { path: "logo.png", kind: "file" as const, size: 99, isText: false },
    { path: "src/b.ts", kind: "file" as const, size: 5, isText: true },
  ];
  expect(projectMap(entries)).toBe("logo.png (99 B, binary)\nsrc/a.ts (10 B)\nsrc/b.ts (5 B)");
  expect(projectMap(entries, 1)).toBe("logo.png (99 B, binary)\n... and 2 more in src");
  expect(projectMap([])).toBe("(no files)");
});

test("pickFiles keeps existing text files in order within the budget", async () => {
  const entries: ProjectFile[] = [
    { path: "README.md", kind: "file", size: 5, isText: true, revision: 2, blobHash: "h1" },
    { path: "big.txt", kind: "file", size: 50, isText: true, revision: 1, blobHash: "h2" },
    { path: "logo.png", kind: "file", size: 9, isText: false, revision: 1, blobHash: "h3" },
    { path: "src", kind: "dir", size: 0, isText: false, revision: 0, blobHash: null },
    { path: ".env.example", kind: "file", size: 4, isText: true, revision: 1, blobHash: "h4" },
  ];
  const text: Record<string, string> = { h1: "hello", h2: "x".repeat(50), h4: "A=1" };
  const out = await pickFiles(["./readme.md", "nope.txt", "big.txt", "logo.png", "src", "README.md", ".env.example"], entries, 20, async (h) => text[h]);
  expect(out.files).toEqual([
    { path: "README.md", revision: 2, content: "hello" },
    { path: ".env.example", revision: 1, content: "A=1" },
  ]);
  expect(out.skipped).toEqual([
    { path: "nope.txt", reason: "not in the project" },
    { path: "big.txt", reason: "too large for the remaining budget" },
    { path: "logo.png", reason: "not a text file" },
    { path: "src", reason: "not a text file" },
  ]);
});

test("shared context and caps", () => {
  expect(sharedContext({})).toBe("");
  expect(sharedContext({ brief: "B", brand: "R" })).toBe("## .company/brief.md\nB\n\n## .company/brand.md\nR");
  const long = sharedContext({ brief: "x".repeat(9000) });
  expect(long.length).toBeLessThan(8200);
  expect(long).toMatch(/\[truncated: the brief and brand files are longer than 8000 characters\]$/);
  expect(cap("abcdef", 3, "result")).toBe("abc\n[truncated: the result is longer than 3 characters]");
  expect(cap("abc", 3, "result")).toBe("abc");
});

test("revision key changes when any file revision changes", () => {
  const a = revisionKey([{ pathLower: "a", revision: 1, kind: "file" }, { pathLower: "d", revision: 0, kind: "dir" }]);
  expect(a).toBe(revisionKey([{ pathLower: "a", revision: 1, kind: "file" }]));
  expect(a).not.toBe(revisionKey([{ pathLower: "a", revision: 2, kind: "file" }]));
});

test("splitEdits strips the trailing edits block", () => {
  const reply = 'Done.\n\n```json\n{"edits":[{"path":"a.ts","content":"x","note":"why"}]}\n```';
  expect(splitEdits(reply)).toEqual({ visible: "Done.", edits: [{ path: "a.ts", content: "x", note: "why" }], error: null });
  expect(splitEdits("No edits here.\n```json\n{\"other\":1}\n```").edits).toEqual([]);
  expect(splitEdits('Oops\n```json\n{"edits":[{"path":1}]}\n```')).toEqual({ visible: "Oops", edits: [], error: "The proposed file changes weren't in the expected format, so none were saved." });
});

test("checkEdit applies the upload rules and requires the file to have been read", () => {
  const read = new Map([["src/app.ts", { path: "src/app.ts", revision: 3 }]]);
  const existing = new Map([
    ["src/app.ts", { path: "src/app.ts", kind: "file" as const, revision: 4 }],
    ["other.ts", { path: "other.ts", kind: "file" as const, revision: 1 }],
    ["docs", { path: "docs", kind: "dir" as const, revision: 0 }],
  ]);
  expect(checkEdit({ path: "SRC/app.ts", content: "x", note: "" }, read, existing)).toEqual({ path: "src/app.ts", baseRevision: 3, status: "pending", reason: null });
  expect(checkEdit({ path: "new.md", content: "x", note: "" }, read, existing)).toEqual({ path: "new.md", baseRevision: 0, status: "pending", reason: null });
  expect(checkEdit({ path: "other.ts", content: "x", note: "" }, read, existing).reason).toBe("the companion didn't read this file");
  expect(checkEdit({ path: ".env", content: "x", note: "" }, read, existing).reason).toMatch(/secret/);
  expect(checkEdit({ path: "k.txt", content: "-----BEGIN RSA PRIVATE KEY-----", note: "" }, read, existing).reason).toBe("contains a private key");
  expect(checkEdit({ path: "../x", content: "x", note: "" }, read, existing).reason).toMatch(/invalid path/);
  expect(checkEdit({ path: "docs", content: "x", note: "" }, read, existing).reason).toBe("a folder has this name");
});

test("edits whose file content contains code fences are read whole (README with ```bash examples)", () => {
  const readme = "# App\n\nRun it:\n\n```bash\nnpm start\n```\n\nOpen:\n\n```text\nhttp://localhost:4173\n```\n";
  const reply = `Here is the project.\n\n\`\`\`json\n${JSON.stringify({ edits: [{ path: "README.md", content: readme, note: "Docs" }, { path: "index.html", content: "<h1>Hi</h1>" }] })}\n\`\`\``;
  expect(splitEdits(reply)).toEqual({
    visible: "Here is the project.",
    edits: [
      { path: "README.md", content: readme, note: "Docs" },
      { path: "index.html", content: "<h1>Hi</h1>", note: "" },
    ],
    error: null,
  });
});

test("a cut-off edits block says so and keeps the prose", () => {
  const reply = 'Done.\n\n```json\n{"edits":[{"path":"a.ts","content":"const a = 1;';
  const out = splitEdits(reply);
  expect(out.edits).toEqual([]);
  expect(out.visible).toBe("Done.");
  expect(out.error).toMatch(/cut off/);
});

test("plan and summary JSON is found even when its text contains code fences", () => {
  const summary = { summary: "Run:\n\n```bash\nnpm start\n```\n\nThen open the page.", verdicts: [] };
  expect(extractJson(`Here you go.\n\n\`\`\`json\n${JSON.stringify(summary)}\n\`\`\``)).toEqual(summary);
});
