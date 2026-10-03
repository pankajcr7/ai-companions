import { expect, test } from "vitest";
import { parseSuggestion } from "../src/goals/suggest.js";

const block = (v: unknown) => `\`\`\`json\n${JSON.stringify(v)}\n\`\`\``;

test("parses a goal, hires, and a new project; ignores other blocks", () => {
  expect(parseSuggestion(`Ok.\n${block({ suggest: { goal: "Plan a launch", hire: [{ role: "Marketing lead", department: "Marketing" }, { role: "" }], newProject: true, projectName: "Launch" } })}`)).toEqual({
    goal: "Plan a launch",
    hire: [{ role: "Marketing lead", department: "Marketing" }],
    newProject: true,
    projectName: "Launch",
  });
  expect(parseSuggestion("No block")).toBeNull();
  expect(parseSuggestion(`Code:\n${block({ name: "x" })}`)).toBeNull();
  expect(parseSuggestion("Bad\n```json\n{\"suggest\": nope}\n```")).toBeNull();
  expect(parseSuggestion(`Empty\n${block({ suggest: {} })}`)).toBeNull();
});
