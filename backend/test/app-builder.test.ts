import * as esbuild from "esbuild";
import { expect, test } from "vitest";
import { buildApp, type AppFiles } from "../src/files/app-builder.js";

// The builder runs in the visitor's browser with esbuild-wasm; here it runs with the same esbuild version natively.
const build = (files: AppFiles) => buildApp(esbuild, files, { assetBase: "https://preview.test/p/" });
const pkg = (deps: Record<string, string>) => JSON.stringify({ name: "app", dependencies: deps });

test("a Vite React app builds, with npm packages from esm.sh at their package.json versions and one shared React", async () => {
  const out = await build({
    "package.json": pkg({ react: "^18.3.1", "react-dom": "^18.3.1", "framer-motion": "^11.0.0" }),
    "index.html": '<!doctype html><html><head><title>Coffee</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
    "src/main.jsx": 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\ncreateRoot(document.getElementById("root")).render(<App />);',
    "src/App.jsx": 'import { motion } from "framer-motion";\nexport default function App() { return <motion.h1>Hello from React</motion.h1>; }',
    "src/index.css": "h1 { color: rebeccapurple; }",
  });
  expect(out.errors).toEqual([]);
  expect(out.kind).toBe("react");
  expect(out.js).toContain("Hello from React");
  expect(out.js).toContain("https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1");
  expect(out.js).toContain("https://esm.sh/framer-motion@11.0.0?deps=react@18.3.1,react-dom@18.3.1");
  expect(out.js).toContain("https://esm.sh/react@18.3.1/jsx-runtime");
  expect(out.css).toContain("rebeccapurple");
  expect(out.title).toBe("Coffee");
  expect(out.body).toContain('<div id="root"></div>');
  expect(out.body).not.toContain("<script");
});

test("CSS modules, @/ paths from tsconfig, and imported images resolve", async () => {
  const out = await build({
    "package.json": pkg({ react: "19.0.0", "react-dom": "19.0.0" }),
    "tsconfig.json": '{\n  // comments are allowed here\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } },\n}',
    "src/main.tsx": 'import { createRoot } from "react-dom/client";\nimport { Card } from "@/components/Card";\ncreateRoot(document.getElementById("root")!).render(<Card />);',
    "src/components/Card.tsx": 'import s from "./Card.module.css";\nimport logo from "../assets/logo.png";\nexport function Card() { return <img className={s.card} src={logo} alt="" />; }',
    "src/components/Card.module.css": ".card { border-radius: 12px; }",
    "src/assets/logo.png": "",
  });
  expect(out.errors).toEqual([]);
  expect(out.css).toMatch(/\.\w*card\w* \{\s*border-radius: 12px;/);
  expect(out.js).toContain("https://preview.test/p/src/assets/logo.png");
  // No index.html: the app gets a root element to render into.
  expect(out.body).toContain('<div id="root"></div>');
});

test("a missing import is reported with its file and line, instead of a blank page", async () => {
  const out = await build({
    "package.json": pkg({ react: "19.0.0", "react-dom": "19.0.0" }),
    "src/main.jsx": 'import { createRoot } from "react-dom/client";\nimport Missing from "./Missing";\ncreateRoot(document.getElementById("root")).render(<Missing />);',
  });
  expect(out.errors).toHaveLength(1);
  expect(out.errors[0]).toMatchObject({ file: "src/main.jsx", line: 2 });
  expect(out.errors[0].text).toContain("./Missing");
});

test("BrowserRouter becomes HashRouter, since a preview lives under its own long address", async () => {
  const out = await build({
    "package.json": pkg({ react: "19.0.0", "react-dom": "19.0.0", "react-router-dom": "^7.1.0" }),
    "src/main.jsx": 'import { createRoot } from "react-dom/client";\nimport { BrowserRouter, Routes, Route } from "react-router-dom";\ncreateRoot(document.getElementById("root")).render(<BrowserRouter><Routes><Route path="/" element={<p>Home</p>} /></Routes></BrowserRouter>);',
  });
  expect(out.errors).toEqual([]);
  // The app's <BrowserRouter> renders HashRouter from the package.
  expect(out.js).toMatch(/jsx\(HashRouter\b/);
  expect(out.js).toContain("https://esm.sh/react-router-dom@7.1.0?deps=react@19.0.0,react-dom@19.0.0");
});

test("Tailwind is picked up: the CSS goes to the Tailwind browser compiler for the project's major version", async () => {
  const out = await build({
    "package.json": JSON.stringify({ dependencies: { react: "19.0.0", "react-dom": "19.0.0" }, devDependencies: { tailwindcss: "^4.0.0" } }),
    "src/main.jsx": 'import "./index.css";\nimport { createRoot } from "react-dom/client";\ncreateRoot(document.getElementById("root")).render(<p className="text-xl">Hi</p>);',
    "src/index.css": '@import "tailwindcss";\n@theme { --color-brand: #a6ff00; }',
  });
  expect(out.errors).toEqual([]);
  expect(out.tailwind).toBe(4);
  expect(out.css).toContain('@import "tailwindcss"');
});

const nextApp: AppFiles = {
  "package.json": pkg({ next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0" }),
  "app/layout.tsx":
    'import "./globals.css";\nimport { Inter, Playfair_Display } from "next/font/google";\nconst inter = Inter({ subsets: ["latin"] });\nconst serif = Playfair_Display({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-serif" });\nexport const metadata = { title: "Brew & Co" };\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body className={`${inter.className} ${serif.variable}`}>{children}</body></html>;\n}',
  "app/globals.css": "body { margin: 0; }",
  "app/page.tsx": 'import Link from "next/link";\nimport Image from "next/image";\nexport default function Home() { return <main><h1>Welcome</h1><Image src="/cup.png" alt="" width={100} height={100} /><Link href="/about">About us</Link></main>; }',
  "app/about/page.tsx": "export default function About() { return <h1>About the shop</h1>; }",
  "app/(shop)/menu/page.tsx": "export default function Menu() { return <h1>Menu</h1>; }",
  "app/blog/[slug]/page.tsx": "export default async function Post({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; return <h1>Post {slug}</h1>; }",
  "public/cup.png": "",
};

test("a Next.js app-router site builds into a client-side app with its pages, layouts, links, images and fonts", async () => {
  const out = await build(nextApp);
  expect(out.errors).toEqual([]);
  expect(out.kind).toBe("next");
  for (const route of ['"/"', '"/about"', '"/menu"', '"/blog/[slug]"']) expect(out.js).toContain(route);
  expect(out.js).toContain("About the shop");
  // next/* comes from the preview's own small stand-ins, not from npm.
  expect(out.js).not.toContain("esm.sh/next");
  expect(out.js).toContain("fonts.googleapis.com");
  expect(out.js).toContain("Playfair Display");
  expect(out.css).toContain("margin: 0");
  expect(out.notes).toEqual([]);
});

test("Next.js server-only parts are named in a note rather than failing the build", async () => {
  const out = await build({
    ...nextApp,
    "app/api/hello/route.ts": 'export async function GET() { return Response.json({ ok: true }); }',
    "app/actions.ts": '"use server";\nexport async function save() {}',
  });
  expect(out.errors).toEqual([]);
  expect(out.notes.join(" ")).toMatch(/API routes/);
  expect(out.notes.join(" ")).toMatch(/server actions/);
});

test("a Next.js pages-router site builds with _app as the wrapper", async () => {
  const out = await build({
    "package.json": pkg({ next: "14.2.0", react: "18.3.1", "react-dom": "18.3.1" }),
    "pages/_app.tsx": 'import type { AppProps } from "next/app";\nexport default function App({ Component, pageProps }: AppProps) { return <div className="shell"><Component {...pageProps} /></div>; }',
    "pages/index.tsx": 'import { useRouter } from "next/router";\nexport default function Home() { const r = useRouter(); return <h1>Home {r.pathname}</h1>; }',
    "pages/products/[id].tsx": "export default function Product() { return <h1>Product</h1>; }",
    "pages/api/items.ts": "export default function handler() {}",
  });
  expect(out.errors).toEqual([]);
  expect(out.kind).toBe("next");
  expect(out.js).toContain('"/products/[id]"');
  expect(out.js).toContain("shell");
  expect(out.notes.join(" ")).toMatch(/API routes/);
});

test("the builder's own text can sit inside the preview page's script tag", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/files/app-builder.js", import.meta.url), "utf8");
  expect(source.toLowerCase()).not.toContain("</script");
  expect(source).not.toContain("<!--");
});
