import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_PAGE, isAppProject } from "./app-preview.ts";

test("projects that look like React or Next.js apps get a live app preview; plain sites and scripts don't", () => {
  assert.equal(APP_PAGE, "__app__");
  assert.equal(isAppProject(["package.json", "index.html", "src/main.jsx", "src/App.jsx"]), true);
  assert.equal(isAppProject(["shop/package.json", "shop/app/page.tsx", "shop/app/layout.tsx"]), true);
  assert.equal(isAppProject(["package.json", "next.config.mjs", "pages/index.js"]), true);
  assert.equal(isAppProject(["package.json", "src/index.js", "public/index.html"]), true);
  assert.equal(isAppProject(["index.html", "style.css", "app.js"]), false);
  assert.equal(isAppProject(["package.json", "server.js"]), false);
  assert.equal(isAppProject(["node_modules/x/package.json", "node_modules/x/a.jsx", "index.html"]), false);
});
