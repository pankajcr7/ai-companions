import { buildApp } from "./app.js";
import { recoverInterrupted } from "./goals/runner.js";

// Work left running by a previous process is marked interrupted; nothing reruns by itself.
await recoverInterrupted();

const app = await buildApp();
// Only the Next.js proxy talks to us, so listen on loopback.
await app.listen({ port: Number(process.env.PORT ?? 4000), host: "127.0.0.1" });
