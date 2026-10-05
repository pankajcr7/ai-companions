import { afterAll, expect, test } from "vitest";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

test("quality checks are on by default and admins can switch them off", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Q Co", template: "starter" })).json().id as string;
  expect((await req("GET", `/api/workspaces/${id}`)).json().workspace.qualityChecks).toBe(true);
  expect((await req("PATCH", `/api/workspaces/${id}`, { qualityChecks: false })).statusCode).toBe(200);
  expect((await req("GET", `/api/workspaces/${id}`)).json().workspace.qualityChecks).toBe(false);
  expect((await req("PATCH", `/api/workspaces/${id}`, { name: "Q Two" })).statusCode).toBe(200);
  expect((await req("GET", `/api/workspaces/${id}`)).json().workspace).toMatchObject({ name: "Q Two", qualityChecks: false });
});
