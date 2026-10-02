// Opt-in live check against a real provider. Never run in CI. Example:
//   LIVE_PROVIDER=openai LIVE_API_KEY=sk-... LIVE_MODEL=<model id> npm --prefix backend run smoke
import "../src/env.js";
import { encryptSecret } from "../src/crypto.js";
import { clientFor } from "../src/providers/index.js";

const kind = process.env.LIVE_PROVIDER as "openai" | "anthropic" | "gemini" | "custom" | undefined;
const key = process.env.LIVE_API_KEY;
const model = process.env.LIVE_MODEL;
if (!kind || !model || (!key && kind !== "custom")) {
  console.error("Set LIVE_PROVIDER (openai|anthropic|gemini|custom), LIVE_MODEL, LIVE_API_KEY, and LIVE_BASE_URL for custom.");
  process.exit(1);
}
const client = clientFor({ id: "smoke", kind, baseUrl: process.env.LIVE_BASE_URL ?? null, secret: key ? encryptSecret(key) : null });
const models = await client.listModels(AbortSignal.timeout(20_000));
console.log(`models listed: ${models.length}`);
let text = "";
for await (const ev of client.stream({ model, instructions: "Reply in five words or fewer.", turns: [{ role: "user", content: "Say hello." }], signal: AbortSignal.timeout(60_000) })) {
  if (ev.type === "delta") text += ev.text;
  else console.log(`reply: ${text.trim()}\nmodel: ${ev.model}\ntokens: ${ev.usage.inputTokens} in, ${ev.usage.outputTokens} out`);
}
