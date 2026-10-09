import { cleanupAttachments } from "./attachments/service.js";
import { buildApp } from "./app.js";
import { recoverInterrupted } from "./goals/runner.js";

// Work left running by a previous process is marked interrupted; nothing reruns by itself.
await recoverInterrupted();

const app = await buildApp();
// Only the Next.js proxy talks to us, so listen on loopback. Hosts like Render set HOST=0.0.0.0.
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? "127.0.0.1" });
// Uploads never sent with a message are removed after a day.
void cleanupAttachments().catch(console.error);
setInterval(() => void cleanupAttachments().catch(console.error), 3600_000).unref();
