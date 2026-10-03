import assert from "node:assert/strict";
import { test } from "node:test";
import { fenceInfo, goalAsMarkdown } from "./rich.ts";

test("fence info reads the language, a title, or a file name used as the language", () => {
  assert.deepEqual(fenceInfo("language-ts"), { language: "ts", title: null });
  assert.deepEqual(fenceInfo("language-typescript"), { language: "ts", title: null });
  assert.deepEqual(fenceInfo("language-tsx", "title=src/app/page.tsx"), { language: "tsx", title: "src/app/page.tsx" });
  assert.deepEqual(fenceInfo("language-js", 'file="lib/a.js"'), { language: "js", title: "lib/a.js" });
  assert.deepEqual(fenceInfo("language-app.tsx"), { language: "tsx", title: "app.tsx" });
  assert.deepEqual(fenceInfo(undefined), { language: "", title: null });
});

test("a goal copies as Markdown with every task", () => {
  const md = goalAsMarkdown({
    text: "Launch",
    summary: "All done.",
    tasks: [
      { position: 0, title: "Copy", agentName: "Ines", status: "done", verdict: "meets", result: "Hello", error: null },
      { position: 1, title: "Code", agentName: "Sana", status: "failed", verdict: null, result: null, error: "Bad key" },
    ] as never,
  });
  assert.equal(md, "# Launch\n\n## Summary\n\nAll done.\n\n## 1. Copy (Ines, done, meets criteria)\n\nHello\n\n## 2. Code (Sana, failed)\n\nBad key");
});
