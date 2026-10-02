import { execSync } from "node:child_process";

export default function setup() {
  execSync("npm --prefix ../backend run db:reset:test", { stdio: "inherit" });
}
