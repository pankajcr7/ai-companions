// Builds a React or Next.js project into one browser-ready module: in the visitor's browser with esbuild-wasm (the
// preview page), or in tests with esbuild. Plain JavaScript with no imports, because the server sends this file's
// text into the preview page as it is. It must never contain a closing script tag, written out.

const CODE = /\.(tsx?|jsx?|mjs|cjs)$/i;
const EXTS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json", ".css"];
const NODE_BUILTINS = new Set(["fs", "path", "os", "crypto", "child_process", "stream", "http", "https", "url", "util", "events", "buffer", "zlib", "net", "tls", "dns", "worker_threads", "perf_hooks", "readline", "assert"]);
const ROUTER_PACKAGES = new Set(["react-router-dom", "react-router"]);

/** Reads JSON that may have comments and trailing commas (tsconfig.json), or returns null. */
function looseJson(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

/** "a/./b/../c" → "a/c"; leading "./" and "/" dropped. */
function norm(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}
const dirname = (path) => path.split("/").slice(0, -1).join("/");

/** "@scope/pkg/sub/x" → ["@scope/pkg", "/sub/x"]; "pkg/sub" → ["pkg", "/sub"]. */
function splitSpecifier(spec) {
  const parts = spec.split("/");
  const n = spec.startsWith("@") ? 2 : 1;
  return [parts.slice(0, n).join("/"), parts.length > n ? "/" + parts.slice(n).join("/") : ""];
}

/**
 * @param esbuild the esbuild module (esbuild-wasm in the browser, already initialized)
 * @param files project files by path relative to the app's root; assets may have empty contents
 * @param options assetBase: the URL the project's files are served from, ending in "/"
 */
export async function buildApp(esbuild, files, { assetBase }) {
  const pkg = looseJson(files["package.json"]) ?? {};
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  const version = (name) => {
    const m = typeof deps[name] === "string" ? /(\d+(?:\.\d+){0,2}(?:-[\w.]+)?)/.exec(deps[name]) : null;
    return m ? m[1] : "";
  };
  const react = version("react") || "19";
  const reactDom = version("react-dom") || react;
  const paths = Object.keys(files);
  const has = (p) => Object.prototype.hasOwnProperty.call(files, p);
  const next = nextLayout(paths, deps);
  const kind = next ? "next" : "react";

  // Where npm packages come from: esm.sh at the package.json version, all sharing one copy of React.
  const npmUrl = (spec) => {
    const [name, sub] = splitSpecifier(spec);
    const v = name === "react" ? react : name === "react-dom" ? reactDom : version(name);
    const at = v ? `@${v}` : "";
    const base = `https://esm.sh/${name}${at}${sub}`;
    if (name === "react") return base;
    if (name === "react-dom") return `${base}?deps=react@${react}`;
    return `${base}?deps=react@${react},react-dom@${reactDom}`;
  };
  const assetUrl = (path) => assetBase + path.split("/").map(encodeURIComponent).join("/");

  // Import aliases: tsconfig/jsconfig "paths", and "@/" pointing at src/ (or the root) when none is set.
  const config = looseJson(files["tsconfig.json"]) ?? looseJson(files["jsconfig.json"]);
  const baseUrl = config?.compilerOptions?.baseUrl ?? ".";
  const aliases = Object.entries(config?.compilerOptions?.paths ?? {})
    .map(([from, to]) => [from, [].concat(to)[0]])
    .filter(([, to]) => typeof to === "string")
    .map(([from, to]) => [from, norm(`${baseUrl}/${to}`)]);
  if (!aliases.some(([from]) => from === "@/*")) aliases.push(["@/*", paths.some((p) => p.startsWith("src/")) && !next?.rootAtTop ? "src/*" : "*"]);
  const unalias = (spec) => {
    for (const [from, to] of aliases) {
      if (from.endsWith("*") && spec.startsWith(from.slice(0, -1))) return to.replace("*", spec.slice(from.length - 1));
      if (from === spec) return to;
    }
    return null;
  };

  /** A project path for an import, trying the usual extensions and index files. */
  const findFile = (base) => {
    const p = norm(base);
    if (has(p)) return p;
    for (const e of EXTS) if (has(p + e)) return p + e;
    for (const e of EXTS) if (has(`${p}/index${e}`)) return `${p}/index${e}`;
    return null;
  };

  // Names imported from virtual modules, so generated modules can export exactly them (next/font/google).
  const imported = (spec) => {
    const names = new Set();
    const re = new RegExp(`import\\s*(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*["']${spec.replace(/[/.]/g, "\\$&")}["']`, "g");
    for (const p of paths) if (CODE.test(p)) for (const m of files[p].matchAll(re)) for (const n of m[1].split(",")) {
      const name = n.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
    return [...names];
  };

  const virtual = virtualModules({ next, kind, assetBase, react, imported, files });
  const entry = next ? { virtual: true } : reactEntry(files, has);
  if (!entry) return { kind, js: "", css: "", body: "", head: "", title: "", tailwind: 0, notes: [], errors: [{ file: "", line: 0, column: 0, text: "No starting file found: add src/main.jsx (Vite), src/index.js (Create React App), or app/page.tsx (Next.js)." }] };
  if (typeof entry.virtual === "string") virtual.__entry__ = entry.virtual;

  const plugin = {
    name: "preview",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const spec = args.path;
        const css = args.kind === "import-rule" || args.kind === "url-token";
        if (/^(data:|https?:|\/\/)/.test(spec)) return { path: spec, external: true };
        if (spec.startsWith("app-file:")) return { path: spec.slice(9), namespace: "app" };
        if (Object.prototype.hasOwnProperty.call(virtual, spec)) return { path: spec, namespace: "virtual" };

        const [clean, query = ""] = spec.split("?");
        const from = args.importer && args.namespace === "app" ? dirname(args.importer) : "";
        let local = null;
        if (clean.startsWith(".")) local = norm(`${from}/${clean}`);
        else if (clean.startsWith("/")) local = norm(clean);
        else local = unalias(clean);

        if (local !== null) {
          // Root-absolute assets ("/logo.png") live in public/ in Vite and Next.js projects.
          const found = findFile(local) ?? (clean.startsWith("/") ? findFile(`public/${local}`) : null);
          if (!found) {
            if (css && clean.startsWith("/")) return { path: assetUrl(`public/${local}`), external: true };
            return { errors: [{ text: `Could not find "${spec}"` }] };
          }
          if (CODE.test(found) || /\.(css|json)$/i.test(found)) {
            if (query === "raw") return { path: found, namespace: "raw" };
            return { path: found, namespace: "app" };
          }
          if (css) return { path: assetUrl(found), external: true };
          return { path: found, namespace: "asset", pluginData: { query } };
        }

        // A bare package name.
        const [name] = splitSpecifier(clean);
        if (css) return { path: name === "tailwindcss" ? clean : `https://cdn.jsdelivr.net/npm/${clean.replace(name, `${name}${version(name) ? "@" + version(name) : ""}`)}`, external: true };
        if (/\.css$/i.test(clean)) return { path: `css:${clean}`, namespace: "virtual" };
        if (ROUTER_PACKAGES.has(clean)) return { path: `router:${clean}`, namespace: "virtual" };
        if (name === "next" || name === "server-only" || name === "client-only" || clean.startsWith("node:") || NODE_BUILTINS.has(name)) return { path: "empty", namespace: "virtual" };
        return { path: npmUrl(clean), external: true };
      });

      build.onLoad({ filter: /.*/, namespace: "app" }, (args) => {
        const p = args.path;
        const loader = /\.module\.css$/i.test(p) ? "local-css" : /\.css$/i.test(p) ? "css" : /\.json$/i.test(p) ? "json" : /\.tsx$/i.test(p) ? "tsx" : /\.ts$/i.test(p) ? "ts" : "jsx";
        return { contents: files[p], loader };
      });
      build.onLoad({ filter: /.*/, namespace: "raw" }, (args) => ({ contents: `export default ${JSON.stringify(files[args.path])};`, loader: "js" }));
      build.onLoad({ filter: /.*/, namespace: "asset" }, (args) => {
        const url = JSON.stringify(assetUrl(args.path));
        // Next.js imports images as { src, width, height }; a String object works both as a URL and like that object.
        const value = kind === "next" ? `Object.assign(new String(${url}), { src: ${url}, width: 0, height: 0 })` : url;
        const svg = /\.svg$/i.test(args.path) ? `import { createElement } from "react";\nexport const ReactComponent = (props) => createElement("img", { ...props, src: ${url} });\n` : "";
        if (args.pluginData?.query === "react") return { contents: `import { createElement } from "react";\nexport default (props) => createElement("img", { ...props, src: ${url} });`, loader: "js" };
        return { contents: `${svg}export default ${value};`, loader: "js" };
      });
      build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
        const p = args.path;
        if (p.startsWith("css:")) {
          const href = JSON.stringify(npmUrl(p.slice(4)).replace(/\?.*$/, ""));
          return { contents: `const l = document.createElement("link"); l.rel = "stylesheet"; l.href = ${href}; document.head.appendChild(l);`, loader: "js" };
        }
        if (p.startsWith("router:")) {
          const url = JSON.stringify(npmUrl(p.slice(7)));
          return { contents: `export * from ${url};\nexport { HashRouter as BrowserRouter, createHashRouter as createBrowserRouter } from ${url};`, loader: "js" };
        }
        return { contents: virtual[p], loader: "jsx" };
      });
    },
  };

  const css = paths.filter((p) => /\.css$/i.test(p)).map((p) => files[p]).join("\n");
  const twMajor = Number(version("tailwindcss").split(".")[0]) || 0;
  const tailwind = twMajor >= 4 ? 4 : twMajor === 3 ? 3 : /@import\s+["']tailwindcss/.test(css) ? 4 : /@tailwind\s/.test(css) ? 3 : 0;

  let result;
  try {
    result = await esbuild.build({
      entryPoints: [entry.virtual ? "__entry__" : `app-file:${entry.path}`],
      bundle: true,
      write: false,
      outdir: "out",
      format: "esm",
      target: "es2022",
      jsx: "automatic",
      jsxImportSource: kind === "next" ? "__preview__" : "react",
      define: {
        "process.env.NODE_ENV": '"development"',
        "process.env": '{"NODE_ENV":"development"}',
        "import.meta.env": '{"MODE":"development","DEV":true,"PROD":false,"SSR":false,"BASE_URL":"/"}',
        global: "globalThis",
      },
      plugins: [plugin],
      logLevel: "silent",
      charset: "utf8",
    });
  } catch (e) {
    const errors = (e.errors ?? [{ text: String(e.message ?? e) }]).map((m) => ({
      file: (m.location?.file ?? "").replace(/^(app|virtual):/, ""),
      line: m.location?.line ?? 0,
      column: m.location?.column ?? 0,
      text: m.text,
    }));
    return { kind, js: "", css: "", body: "", head: "", title: "", tailwind, notes: [], errors };
  }
  const out = (ext) => result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? "";
  const shell = kind === "next" ? { body: '<div id="__next"></div>', head: "", title: "" } : htmlShell(files["index.html"] ?? files["public/index.html"]);
  return { kind, js: out(".js"), css: out(".css"), ...shell, tailwind, notes: next ? serverNotes(files, paths) : [], errors: [] };
}

/** Next.js routes: the app/ (or src/app/) router, else pages/ (or src/pages/). Null when this isn't a Next.js app. */
function nextLayout(paths, deps) {
  const isPage = (base, p) => new RegExp(`^${base}/(.+/)?page\\.(tsx|ts|jsx|js)$`).test(p);
  for (const base of ["app", "src/app"]) {
    if (!paths.some((p) => isPage(base, p))) continue;
    const routes = [];
    for (const p of paths.filter((x) => isPage(base, x))) {
      const dirs = p.slice(base.length + 1).split("/").slice(0, -1);
      // Parallel (@slot) and intercepting ((.)x) routes need a server; groups ((x)) don't change the address.
      if (dirs.some((d) => d.startsWith("@") || /^\(\.+\)/.test(d))) continue;
      const pattern = "/" + dirs.filter((d) => !/^\(.*\)$/.test(d)).join("/");
      const layouts = [];
      for (let i = 0; i <= dirs.length; i++) {
        const dir = [base, ...dirs.slice(0, i)].join("/");
        const layout = ["tsx", "jsx", "ts", "js"].map((e) => `${dir}/layout.${e}`).find((l) => paths.includes(l));
        if (layout) layouts.push(layout);
      }
      routes.push({ pattern, page: p, layouts });
    }
    const notFound = ["tsx", "jsx", "ts", "js"].map((e) => `${base}/not-found.${e}`).find((p) => paths.includes(p)) ?? null;
    return { router: "app", routes, notFound, rootAtTop: base === "app" };
  }
  for (const base of ["pages", "src/pages"]) {
    const pages = paths.filter((p) => new RegExp(`^${base}/.+\\.(tsx|ts|jsx|js)$`).test(p) && !new RegExp(`^${base}/(_app|_document|_error)\\.|^${base}/api/`).test(p));
    if (!pages.length) continue;
    const routes = pages.map((p) => {
      const parts = p.slice(base.length + 1).replace(/\.(tsx|ts|jsx|js)$/, "").split("/");
      if (parts[parts.length - 1] === "index") parts.pop();
      return { pattern: "/" + parts.join("/"), page: p, layouts: [] };
    });
    const app = ["tsx", "jsx", "ts", "js"].map((e) => `${base}/_app.${e}`).find((p) => paths.includes(p)) ?? null;
    return { router: "pages", routes, app, notFound: null, rootAtTop: base === "pages" };
  }
  return "next" in deps ? { router: "app", routes: [], notFound: null, rootAtTop: true } : null;
}

/** What a Next.js project has that can't run in a browser preview. */
function serverNotes(files, paths) {
  const notes = [];
  if (paths.some((p) => /(^|\/)app\/(.+\/)?route\.(tsx?|jsx?)$/.test(p) || /(^|\/)pages\/api\//.test(p))) notes.push("API routes don't run in the preview.");
  if (paths.some((p) => CODE.test(p) && /^\s*["']use server["']/m.test(files[p]))) notes.push("Forms that use server actions don't run in the preview.");
  if (paths.some((p) => /^(src\/)?middleware\.(ts|js)$/.test(p))) notes.push("Middleware doesn't run in the preview.");
  return notes;
}

/** The starting file of a plain React app: the module index.html loads, else the usual names. */
function reactEntry(files, has) {
  const html = files["index.html"] ?? files["public/index.html"];
  const src = html ? /<script[^>]*type=["']module["'][^>]*src=["']\/?([^"'?]+)/i.exec(html)?.[1] : null;
  const candidates = [src, ...["src/main", "src/index", "main", "index", "src/App", "App"].flatMap((c) => [".tsx", ".jsx", ".ts", ".js"].map((e) => c + e))];
  const path = candidates.find((c) => c && has(c) && CODE.test(c));
  if (!path) return null;
  // A file that only defines the app (no createRoot or render call) gets a small starter around it.
  if (/createRoot|hydrateRoot|\.render\s*\(/.test(files[path])) return { path };
  return {
    virtual: `import { createElement } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "app-file:${path}";\ncreateRoot(document.getElementById("root")).render(createElement(App));`,
  };
}

/** index.html's body markup (without its scripts), title and outside stylesheets; a #root div when there is none. */
function htmlShell(html) {
  if (!html) return { body: '<div id="root"></div>', head: "", title: "" };
  const scriptTag = new RegExp("<script\\b[\\s\\S]*?<\\/script\\s*>", "gi");
  const body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html).replace(scriptTag, "").trim();
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const head = [...html.matchAll(/<link\b[^>]*href=["']https?:[^"']+["'][^>]*>/gi)].map((m) => m[0]).join("");
  return { body: body || '<div id="root"></div>', head, title };
}

/** The small stand-ins for Next.js and the generated entry module. */
function virtualModules({ next, kind, assetBase, imported }) {
  const v = { empty: "module.exports = {};" };
  if (kind !== "next") return v;
  const base = JSON.stringify(assetBase);

  v.__router__ = `
import { createContext, useContext, useSyncExternalStore } from "react";
const listeners = new Set();
const read = () => { const h = decodeURI(location.hash.slice(1)) || "/"; return h.startsWith("/") ? h : "/" + h; };
let current = read();
const emit = () => { current = read(); listeners.forEach((l) => l()); };
addEventListener("hashchange", () => { emit(); scrollTo(0, 0); });
export const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));
export const useLocation = () => useSyncExternalStore(subscribe, () => current, () => current);
export const split = (url) => { const [path, query = ""] = url.split("?"); return { pathname: path.split("#")[0] || "/", search: query.split("#")[0] }; };
export const internal = (href) => typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
export const hrefOf = (href) => typeof href === "string" ? href : (href?.pathname ?? "/") + (href?.query ? "?" + new URLSearchParams(href.query) : "") + (href?.hash ? "#" + href.hash : "");
export const toHash = (href) => (internal(href) ? "#" + href : href);
export function navigate(href, replace) {
  href = hrefOf(href);
  if (!internal(href)) { location.href = href; return; }
  if (replace) { history.replaceState(null, "", "#" + href); emit(); } else location.hash = href;
}
export const publicUrl = (src) => (internal(src) ? ${base} + "public" + src : src);
export const RouteContext = createContext({ params: {}, pattern: "/" });
export const useRoute = () => useContext(RouteContext);
export class Redirect extends Error { constructor(url) { super("NEXT_REDIRECT"); this.url = url; } }
export class NotFound extends Error { constructor() { super("NEXT_NOT_FOUND"); } }
`;

  v["next/link"] = `
import { createElement, forwardRef } from "react";
import { hrefOf, internal, navigate, toHash } from "__router__";
const Link = forwardRef(function Link({ href, as, replace, scroll, shallow, prefetch, legacyBehavior, passHref, locale, children, onClick, ...rest }, ref) {
  const url = hrefOf(as ?? href);
  return createElement("a", { ...rest, ref, href: toHash(url), onClick(e) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === "_blank" || !internal(url)) return;
    e.preventDefault();
    navigate(url, replace);
  } }, children);
});
export default Link;
`;

  v["next/navigation"] = `
import { useLocation, useRoute, navigate, split, Redirect, NotFound } from "__router__";
export function useRouter() { return { push: (h) => navigate(h), replace: (h) => navigate(h, true), back: () => history.back(), forward: () => history.forward(), refresh() {}, prefetch() {} }; }
export const usePathname = () => split(useLocation()).pathname;
export const useSearchParams = () => new URLSearchParams(split(useLocation()).search);
export const useParams = () => useRoute().params;
export const useSelectedLayoutSegments = () => split(useLocation()).pathname.split("/").filter(Boolean);
export const useSelectedLayoutSegment = () => useSelectedLayoutSegments()[0] ?? null;
export function redirect(url) { throw new Redirect(url); }
export const permanentRedirect = redirect;
export function notFound() { throw new NotFound(); }
export const RedirectType = { push: "push", replace: "replace" };
`;

  v["next/router"] = `
import { createElement } from "react";
import { useLocation, useRoute, navigate, split, hrefOf } from "__router__";
const go = (h, replace) => (navigate(hrefOf(h), replace), Promise.resolve(true));
const Router = { push: (h) => go(h), replace: (h) => go(h, true), back: () => history.back(), reload: () => location.reload(), prefetch: () => Promise.resolve(), beforePopState() {}, events: { on() {}, off() {}, emit() {} }, isReady: true, isFallback: false, isPreview: false, basePath: "" };
export function useRouter() {
  const loc = useLocation();
  const { params, pattern } = useRoute();
  return { ...Router, pathname: pattern, route: pattern, asPath: loc, query: { ...Object.fromEntries(new URLSearchParams(split(loc).search)), ...params } };
}
export const withRouter = (C) => (props) => createElement(C, { ...props, router: useRouter() });
export default Router;
`;

  v["next/image"] = `
import { createElement, forwardRef } from "react";
import { publicUrl } from "__router__";
const srcOf = (src) => publicUrl(typeof src === "string" ? src : String(src?.default?.src ?? src?.src ?? src ?? ""));
const Image = forwardRef(function Image({ src, alt = "", width, height, fill, sizes, priority, quality, placeholder, blurDataURL, loader, unoptimized, loading, style, onLoadingComplete, overrideSrc, ...rest }, ref) {
  const fit = fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } : {};
  return createElement("img", { ...rest, ref, alt, src: srcOf(src), width: fill ? undefined : width, height: fill ? undefined : height, sizes, loading: priority ? "eager" : loading ?? "lazy", decoding: "async", style: { ...fit, ...style } });
});
export default Image;
export const getImageProps = (props) => ({ props: { ...props, src: srcOf(props.src) } });
`;

  v["next/head"] = `
import { Children, isValidElement, useEffect } from "react";
export default function Head({ children }) {
  useEffect(() => { Children.forEach(children, (c) => { if (isValidElement(c) && c.type === "title") document.title = [].concat(c.props.children).join(""); }); });
  return null;
}
`;

  v["next/script"] = `
import { useEffect } from "react";
export default function Script({ src, strategy, onLoad, onReady, onError, children, dangerouslySetInnerHTML, id }) {
  useEffect(() => {
    const s = document.createElement("script");
    if (src) s.src = src;
    const code = dangerouslySetInnerHTML?.__html ?? (typeof children === "string" ? children : "");
    if (code) s.text = code;
    if (id) s.id = id;
    s.onload = () => { onLoad?.(); onReady?.(); };
    s.onerror = (e) => onError?.(e);
    document.body.appendChild(s);
    return () => s.remove();
  }, [src]);
  return null;
}
`;

  v["next/dynamic"] = `
import { createElement, lazy, Suspense } from "react";
export default function dynamic(load, options = {}) {
  const Lazy = lazy(() => Promise.resolve(typeof load === "function" ? load() : load).then((m) => ({ default: m?.default ?? m })));
  return (props) => createElement(Suspense, { fallback: options.loading ? createElement(options.loading, { isLoading: true }) : null }, createElement(Lazy, props));
}
`;

  // Google fonts load for real; every font the project imports gets a class and an optional CSS variable.
  const fonts = imported("next/font/google");
  v["next/font/google"] = `
const done = new Set();
function once(key, add) { if (!done.has(key)) { done.add(key); add(); } }
function font(family, opts = {}) {
  const weights = [].concat(opts.weight ?? []).filter((w) => w !== "variable").map(Number).sort((a, b) => a - b);
  const italic = [].concat(opts.style ?? []).includes("italic");
  const axis = weights.length ? (italic ? ":ital,wght@" + [...weights.map((w) => "0," + w), ...weights.map((w) => "1," + w)].join(";") : ":wght@" + weights.join(";")) : "";
  const href = "https://fonts.googleapis.com/css2?family=" + family.replace(/ /g, "+") + axis + "&display=swap";
  once(href, () => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); });
  const id = "__font_" + family.replace(/\\W/g, "_");
  const stack = "'" + family + "', " + ([].concat(opts.fallback ?? []).join(", ") || "sans-serif");
  const variable = opts.variable ? id + "_v" : "";
  once(id + (opts.variable ?? ""), () => {
    const s = document.createElement("style");
    s.textContent = "." + id + "{font-family:" + stack + "}" + (opts.variable ? "." + variable + "{" + opts.variable + ":" + stack + "}" : "");
    document.head.appendChild(s);
  });
  return { className: id, variable, style: { fontFamily: stack } };
}
${fonts.map((n) => `export const ${n} = (opts) => font(${JSON.stringify(n.replace(/_/g, " "))}, opts);`).join("\n")}
`;
  v["next/font/local"] = `export default function localFont() { return { className: "", variable: "", style: {} }; }`;

  // JSX for Next.js: <html>, <body> and <head> in layouts apply to the page's own document, and async (server)
  // components are awaited once and then shown.
  v["__preview__/jsx-runtime"] = `
import { Fragment, jsx as plain, jsxs as plainMany } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
export { Fragment };
function Html({ children, lang, className }) {
  useLayoutEffect(() => { if (lang) document.documentElement.lang = lang; if (className) document.documentElement.className = className; }, [lang, className]);
  return children ?? null;
}
function Body({ children, className, style }) {
  useLayoutEffect(() => { document.body.className = className ?? ""; if (style) Object.assign(document.body.style, style); }, [className, style]);
  return children ?? null;
}
function Head({ children }) { return createPortal(children, document.head); }
function Async({ __fn, ...props }) {
  const [state, set] = useState({ value: null });
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => __fn(props)).then((value) => live && set({ value }), (error) => live && set({ error }));
    return () => { live = false; };
  }, [__fn]);
  if (state.error) throw state.error;
  return state.value;
}
function pick(type, props) {
  if (typeof type === "function" && type.constructor?.name === "AsyncFunction") return [Async, { ...props, __fn: type }];
  return [type === "html" ? Html : type === "body" ? Body : type === "head" ? Head : type, props];
}
export function jsx(type, props, key) { const [t, p] = pick(type, props); return plain(t, p, key); }
export function jsxs(type, props, key) { const [t, p] = pick(type, props); return plainMany(t, p, key); }
export const jsxDEV = jsx;
`;
  v["__preview__/jsx-dev-runtime"] = `export { jsx, jsxs, jsxDEV, Fragment } from "__preview__/jsx-runtime";`;

  // The entry: the route table, matching, layouts around pages, titles from metadata, and redirects / 404s.
  const routes = next.routes;
  const mod = (path, i) => `import * as M${i} from "app-file:${path}";`;
  const modules = [...new Set(routes.flatMap((r) => [r.page, ...r.layouts]).concat(next.app ?? [], next.notFound ?? []))];
  const ref = (path) => `M${modules.indexOf(path)}`;
  v.__entry__ = `
import { Component, createElement as h, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { jsx } from "__preview__/jsx-runtime";
import { useLocation, split, RouteContext, navigate, Redirect, NotFound } from "__router__";
${modules.map(mod).join("\n")}
const router = ${JSON.stringify(next.router)};
const App = ${next.app ? `${ref(next.app)}.default` : "null"};
const NotFoundPage = ${next.notFound ? `${ref(next.notFound)}.default` : "null"};
const routes = [
${routes.map((r) => `  { pattern: ${JSON.stringify(r.pattern)}, page: ${ref(r.page)}, layouts: [${r.layouts.map(ref).join(", ")}] },`).join("\n")}
];
const rank = (pattern) => pattern.split("/").filter(Boolean).map((s) => (s.startsWith("[[") ? 3 : s.startsWith("[...") ? 2 : s.startsWith("[") ? 1 : 0));
routes.sort((a, b) => { const x = rank(a.pattern), y = rank(b.pattern); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? -1) - (y[i] ?? -1); if (d) return d; } return 0; });
function match(pattern, path) {
  const ps = pattern.split("/").filter(Boolean), xs = path.split("/").filter(Boolean), params = {};
  for (let i = 0; i < ps.length; i++) {
    let m;
    if ((m = /^\\[\\[\\.\\.\\.(.+)\\]\\]$/.exec(ps[i]))) { params[m[1]] = xs.slice(i).map(decodeURIComponent); return params; }
    if ((m = /^\\[\\.\\.\\.(.+)\\]$/.exec(ps[i]))) { if (i >= xs.length) return null; params[m[1]] = xs.slice(i).map(decodeURIComponent); return params; }
    if (i >= xs.length) return null;
    if ((m = /^\\[(.+)\\]$/.exec(ps[i]))) params[m[1]] = decodeURIComponent(xs[i]);
    else if (ps[i] !== xs[i]) return null;
  }
  return ps.length === xs.length ? params : null;
}
// Next.js 15 passes params as a promise; older code reads them directly, so they work both ways.
const both = (value) => Object.assign(Promise.resolve(value), value);
function titleOf(route) {
  let template = "%s", title = "";
  for (const m of [...route.layouts, route.page]) {
    const t = m.metadata?.title;
    if (typeof t === "string") title = t;
    else if (t) { if (t.template) template = t.template; if (t.absolute) { title = t.absolute; template = "%s"; } else if (t.default) title = t.default; }
  }
  return title ? template.replace("%s", title) : "";
}
const missing = () => NotFoundPage ? jsx(NotFoundPage, {}) : h("main", { style: { fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", textAlign: "center" } }, h("h1", null, "404"), h("p", null, "This page could not be found."));
class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { if (error instanceof Redirect) navigate(error.url, true); else if (!(error instanceof NotFound)) window.__previewError?.(error); }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    if (e instanceof NotFound) return missing();
    if (e instanceof Redirect) return null;
    return h("p", { style: { fontFamily: "system-ui, sans-serif", padding: "2rem" } }, "This page hit an error: " + (e?.message ?? e));
  }
}
function PagesPage({ route, params, query }) {
  const data = route.page.getServerSideProps ?? route.page.getStaticProps;
  const [props, setProps] = useState(data ? null : {});
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!data) return;
    let live = true;
    Promise.resolve().then(() => data({ params, query })).then((r) => {
      if (!live) return;
      if (r?.redirect) navigate(r.redirect.destination, true);
      else if (r?.notFound) setError(new NotFound());
      else setProps(r?.props ?? {});
    }, (e) => { console.warn("This page loads data on the server; the preview shows it without that data.", e); live && setProps({}); });
    return () => { live = false; };
  }, [data]);
  if (error) throw error;
  if (!props) return null;
  const page = h(route.page.default, props);
  return App ? h(App, { Component: route.page.default, pageProps: props }) : page;
}
function Root() {
  const location = useLocation();
  const { pathname, search } = split(location);
  const query = Object.fromEntries(new URLSearchParams(search));
  const found = routes.map((r) => [r, match(r.pattern, pathname)]).find(([, p]) => p);
  const title = found ? titleOf(found[0]) : "";
  useEffect(() => { if (title) document.title = title; }, [title]);
  if (!found) return missing();
  const [route, params] = found;
  let page;
  if (router === "pages") page = h(PagesPage, { route, params, query });
  else {
    page = jsx(route.page.default, { params: both(params), searchParams: both(query) });
    for (const layout of [...route.layouts].reverse()) page = jsx(layout.default, { params: both(params), children: page });
  }
  return h(RouteContext.Provider, { value: { params, pattern: route.pattern } }, h(Boundary, { key: location }, h(Suspense, { fallback: null }, page)));
}
createRoot(document.getElementById("__next")).render(h(Root));
`;
  return v;
}

/** In the preview page: build the project, show it, and show build or runtime errors clearly instead of a blank page. */
export async function startPreview({ esbuild, wasmURL, files, assetBase }) {
  const status = document.getElementById("__preview_status");
  const panel = (title, lines) => {
    status?.remove();
    const box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#0b0d10;color:#eef0f3;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;padding:28px";
    const h = document.createElement("p");
    h.style.cssText = "font:600 17px/1.4 system-ui,sans-serif;color:#ff8a7a;margin:0 0 6px";
    h.textContent = title;
    const hint = document.createElement("p");
    hint.style.cssText = "font:14px/1.5 system-ui,sans-serif;color:#9aa1ad;margin:0 0 18px";
    hint.textContent = "Ask your team to fix it: copy this message into the chat.";
    box.append(h, hint);
    for (const line of lines) {
      const p = document.createElement("pre");
      p.style.cssText = "white-space:pre-wrap;margin:0 0 12px;padding:12px 14px;border-radius:10px;background:#16191d";
      p.textContent = line;
      box.append(p);
    }
    document.body.append(box);
  };
  window.__previewError = (e) => panel("Your app crashed while running", [String(e?.stack ?? e?.message ?? e)]);
  addEventListener("error", (e) => window.__previewError(e.error ?? e.message));
  addEventListener("unhandledrejection", (e) => window.__previewError(e.reason));

  try {
    await esbuild.initialize({ wasmURL, worker: false });
  } catch (e) {
    if (!/initialize/.test(String(e?.message))) return panel("The preview couldn't start", [String(e?.message ?? e)]);
  }
  const out = await buildApp(esbuild, files, { assetBase });
  if (out.errors.length) return panel("Your app has a build error", out.errors.map((e) => (e.file ? `${e.file}:${e.line}:${e.column}\n` : "") + e.text));

  if (out.title) document.title = out.title;
  if (out.head) document.head.insertAdjacentHTML("beforeend", out.head);
  const style = document.createElement("style");
  if (out.tailwind) style.type = "text/tailwindcss";
  style.textContent = out.css;
  document.head.append(style);
  if (out.tailwind) {
    const tw = document.createElement("script");
    tw.src = out.tailwind >= 4 ? "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.11" : "https://cdn.tailwindcss.com/3.4.17";
    document.head.append(tw);
  }
  document.body.innerHTML = out.body;

  // Root-absolute pictures ("/logo.png") are served from public/ (Vite and Next.js); plain links stay inside the preview.
  const fix = (el) => {
    for (const attr of ["src", "poster"]) {
      const v = el.getAttribute?.(attr);
      if (v && v.startsWith("/") && !v.startsWith("//")) el.setAttribute(attr, assetBase + "public" + v);
    }
  };
  new MutationObserver((list) => list.forEach((m) => (m.type === "attributes" ? fix(m.target) : m.addedNodes.forEach((n) => n.nodeType === 1 && [n, ...n.querySelectorAll("img,video,source")].forEach(fix))))).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "poster"] });
  addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    const href = a?.getAttribute("href");
    if (!href || !href.startsWith("/") || href.startsWith("//") || a.target === "_blank" || e.defaultPrevented) return;
    e.preventDefault();
    location.hash = href;
  });

  if (out.notes.length) {
    const note = document.createElement("div");
    note.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483646;max-width:320px;padding:10px 12px;border-radius:10px;background:rgba(11,13,16,.88);color:#eef0f3;font:12px/1.45 system-ui,sans-serif";
    note.textContent = "Preview: " + out.notes.join(" ");
    note.onclick = () => note.remove();
    document.body.append(note);
  }
  const script = document.createElement("script");
  script.type = "module";
  script.textContent = out.js;
  document.body.append(script);
  status?.remove();
}
