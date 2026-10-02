import { buildApp } from "./app.js";

const app = await buildApp();
// Only the Next.js proxy talks to us, so listen on loopback.
await app.listen({ port: Number(process.env.PORT ?? 4000), host: "127.0.0.1" });
