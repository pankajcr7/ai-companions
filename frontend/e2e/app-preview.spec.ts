import { expect, test, type Page } from "@playwright/test";
import { newCompany } from "./setup";

// These previews build in the browser: esbuild-wasm from jsDelivr and packages from esm.sh, so they need the internet.
const headers = { origin: "http://localhost:3100" };

async function projectWith(page: Page, name: string, files: Record<string, string>) {
  const co = await newCompany(page, { prefix: "AppPreview", company: `App Preview ${name} ${Date.now()}`, template: /Just the head agent/ });
  const pid = (await (await page.request.post(`/api/workspaces/${co.id}/projects`, { headers, data: { name } })).json()).id as string;
  for (const [path, content] of Object.entries(files)) {
    const res = await page.request.put(`/api/workspaces/${co.id}/projects/${pid}/files`, { headers, data: { path, content, baseRevision: 0 } });
    expect(res.ok()).toBe(true);
  }
  await page.goto(`/w/${co.slug}/projects/${pid}`);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  return page.frameLocator(`iframe[title="Preview of ${name}"]`);
}

test("a React app builds and runs in the preview, and its buttons work", async ({ page }) => {
  const app = await projectWith(page, "Counter app", {
    "package.json": JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" } }),
    "index.html": '<!doctype html><html><head><title>Counter</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
    "src/main.jsx": 'import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\ncreateRoot(document.getElementById("root")).render(<App />);',
    "src/App.jsx": 'import { useState } from "react";\nexport default function App() {\n  const [n, setN] = useState(0);\n  return <main><h1>Hello from React</h1><button onClick={() => setN(n + 1)}>Count: {n}</button></main>;\n}',
    "src/index.css": "h1 { color: rgb(1, 2, 3); }",
  });
  await expect(app.getByRole("heading", { name: "Hello from React" })).toBeVisible({ timeout: 90_000 });
  await expect(app.getByRole("heading", { name: "Hello from React" })).toHaveCSS("color", "rgb(1, 2, 3)");
  await app.getByRole("button", { name: "Count: 0" }).click();
  await expect(app.getByRole("button", { name: "Count: 1" })).toBeVisible();
});

test("a Next.js site builds with its layout, and links move between its pages", async ({ page }) => {
  const app = await projectWith(page, "Coffee site", {
    "package.json": JSON.stringify({ dependencies: { next: "15.1.0", react: "19.0.0", "react-dom": "19.0.0" } }),
    "app/layout.tsx": 'export const metadata = { title: "Brew & Co" };\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body><header>Brew &amp; Co</header>{children}</body></html>;\n}',
    "app/page.tsx": 'import Link from "next/link";\nexport default function Home() { return <main><h1>Welcome</h1><Link href="/about">About us</Link></main>; }',
    "app/about/page.tsx": "export default async function About() { return <h1>About the shop</h1>; }",
  });
  await expect(app.getByRole("heading", { name: "Welcome" })).toBeVisible({ timeout: 90_000 });
  await expect(app.getByText("Brew & Co")).toBeVisible();
  await app.getByRole("link", { name: "About us" }).click();
  await expect(app.getByRole("heading", { name: "About the shop" })).toBeVisible();
});

test("a build error shows the file and the problem instead of a blank page", async ({ page }) => {
  const app = await projectWith(page, "Broken app", {
    "package.json": JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" } }),
    "src/main.jsx": 'import { createRoot } from "react-dom/client";\nimport Header from "./Header";\ncreateRoot(document.getElementById("root")).render(<Header />);',
  });
  const alert = app.getByRole("alert");
  await expect(alert).toContainText("Your app has a build error", { timeout: 90_000 });
  await expect(alert).toContainText("src/main.jsx:2");
  await expect(alert).toContainText('Could not find "./Header"');
});

test("a Remotion video project plays in the video player instead of showing a white page", async ({ page }) => {
  const app = await projectWith(page, "Promo video", {
    "package.json": JSON.stringify({ scripts: { preview: "remotion studio src/index.jsx" }, dependencies: { remotion: "4.0.242", react: "18.3.1", "react-dom": "18.3.1" } }),
    "src/index.jsx":
      'import { AbsoluteFill, Composition, registerRoot, useCurrentFrame } from "remotion";\nconst Film = () => <AbsoluteFill style={{ background: "white", fontSize: 80 }}>Hello video, frame {useCurrentFrame()}</AbsoluteFill>;\nregisterRoot(() => <Composition id="Promo" component={Film} width={1280} height={720} fps={30} durationInFrames={90} />);',
  });
  await expect(app.getByText("Video preview")).toBeVisible({ timeout: 90_000 });
  await expect(app.getByText("Hello video, frame 0")).toBeVisible();
  await expect(app.getByText("0:00 / 0:03")).toBeVisible();
});

test("an app that runs but draws nothing says so, instead of a white page", async ({ page }) => {
  const app = await projectWith(page, "Empty app", {
    "package.json": JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" } }),
    "src/main.jsx": 'import { createRoot } from "react-dom/client";\ncreateRoot(document.createElement("div")).render(<p>Nowhere</p>);',
  });
  await expect(app.getByRole("status")).toContainText("The app ran, but nothing appeared on the page.", { timeout: 90_000 });
});
