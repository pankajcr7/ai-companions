import { execSync } from "node:child_process";
import { startFakeLlm } from "./fake-llm";

export default async function setup() {
  execSync("npm --prefix ../backend run db:reset:test", { stdio: "inherit" });
  const server = await startFakeLlm();
  return () => new Promise<void>((r) => server.close(() => r()));
}
