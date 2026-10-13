import { safeFetch } from "../safe-fetch.js";
import { ToolError } from "./loop.js";
import { fetchPage, htmlToText, readBytes, untrusted } from "./web.js";

const MAX_LIST = 40;
const SCRIPTS = 5;
const SCRIPT_BYTES = 1024 * 1024;

/** De-duplicated, first 40, or "none found". */
export const list = (items: Iterable<string>) => {
  const all = [...new Set(items)].slice(0, MAX_LIST);
  return all.length ? all.join(", ") : "none found";
};
export const rebuild = (what: string) => `Rebuild ${what} in your own code. Don't copy this site's code, images, logos or wording.`;

// Narrow on purpose: a word like "bootstrap" in page code isn't enough.
const MARKERS: [string, RegExp][] = [
  ["Next.js", /\/_next\/|__NEXT_DATA__/],
  ["Nuxt", /\/_nuxt\/|__NUXT__/],
  ["Gatsby", /___gatsby/],
  ["Remix", /__remixContext/],
  ["SvelteKit", /__sveltekit/],
  ["Astro", /astro-island/],
  ["Angular", /ng-version=/],
  ["Vue", /data-v-[0-9a-f]{8}/],
  ["React", /data-reactroot|react-dom/],
  ["WordPress", /wp-content/],
  ["Shopify", /cdn\.shopify\.com/],
  ["Webflow", /data-wf-page/],
  ["Framer", /framerusercontent\.com/],
  ["Wix", /wixstatic\.com/],
  ["Squarespace", /static1\.squarespace\.com/],
  ["Bootstrap", /bootstrap[\w.-]*\.(?:css|js)\b/i],
  ["jQuery", /jquery[\w.-]*\.js\b/i],
];
const REACT_BASED = ["Next.js", "Gatsby", "Remix"];

const API_CALLS = [
  /\bfetch\(\s*(["'`])((?:\/|https?:\/\/)[^"'`\s]*)\1/g,
  /\baxios\.(?:get|post|put|patch|delete)\(\s*(["'`])((?:\/|https?:\/\/)[^"'`\s]*)\1/g,
  /(["'`])(\/(?:api|graphql)\b[^"'`\s]*)\1/g,
];
const FILE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|pdf|zip|css|m?js|json|xml|txt|woff2?|ttf|otf|mp4|webm|mp3)$/i;

async function script(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await safeFetch(url, { signal });
    return res.ok ? (await readBytes(res, SCRIPT_BYTES)).data.toString("utf8") : null;
  } catch (e) {
    if (signal.aborted) throw e;
    return null;
  }
}

/** Clues about how a page is built, read from its HTML and up to 5 of its own scripts. */
export async function studyWebsite(url: string, signal: AbortSignal): Promise<string> {
  const page = await fetchPage(url, signal);
  if (!/html/i.test(page.type)) throw new ToolError("Only web pages can be studied.");
  const html = page.body;
  const base = new URL(url);
  const urls = (re: RegExp) =>
    [...html.matchAll(re)].flatMap((m) => {
      try {
        const u = new URL(m[1], base);
        return /^https?:$/.test(u.protocol) ? [u] : [];
      } catch {
        return [];
      }
    });

  const scripts = urls(/<script\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi);
  const fetched = (await Promise.all(scripts.filter((u) => u.host === base.host).slice(0, SCRIPTS).map((u) => script(u.href, signal)))).filter((s): s is string => s !== null);
  const inline = [...html.matchAll(/<script\b(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

  const generator = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\sname\s*=\s*["']generator["']/i.test(t))?.match(/\scontent\s*=\s*["']([^"']+)["']/i)?.[1];
  const hay = [html, ...scripts.map((u) => u.href)].join("\n");
  const built: string[] = generator ? [htmlToText(generator)] : [];
  for (const [name, re] of MARKERS) if (re.test(hay) || (name === "React" && built.some((n) => REACT_BASED.includes(n)))) built.push(name);

  const api = [...inline, ...fetched].flatMap((code) => API_CALLS.flatMap((re) => [...code.matchAll(re)].map((m) => m[2])));
  const pages = urls(/<a\b[^>]*?\shref\s*=\s*["']([^"']+)["']/gi).filter((u) => u.host === base.host && !FILE.test(u.pathname)).map((u) => u.pathname);
  const outside = urls(/<(?:script|link|img|iframe|source)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["']/gi).filter((u) => u.host !== base.host).map((u) => u.host);
  const title = htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");

  const body = [
    `Website: ${title || "(no title)"} — ${url}`,
    `Built with: ${built.length ? `${list(built)} (from page markers)` : "none found"}`,
    `API calls in its scripts: ${list(api)}`,
    `Pages it links to: ${list(pages)}`,
    `Outside services it loads: ${list(outside)}`,
    `Scripts: ${scripts.length} on the page, looked through ${fetched.length}.`,
  ].join("\n");
  return `${untrusted(body)}\nThese are clues from the page's HTML and scripts, not a full analysis.\n${rebuild("the idea and how it works")}`;
}
