import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneScreens } from "./screens.ts";

test("only screens/*.html are phone screens, in number order, named from the file name", () => {
  const paths = ["screens/10-settings.html", "index.html", "screens/02-profile.html", "screens/01-home.html", "screens/03-order-history.html", "screens/notes.md", "design/screens.md", "screens/old/x.html", "screens/login.html", "Screens/04-Map.HTML"];
  assert.deepEqual(phoneScreens(paths), [
    { path: "screens/01-home.html", name: "Home" },
    { path: "screens/02-profile.html", name: "Profile" },
    { path: "screens/03-order-history.html", name: "Order history" },
    { path: "Screens/04-Map.HTML", name: "Map" },
    { path: "screens/10-settings.html", name: "Settings" },
    { path: "screens/login.html", name: "Login" },
  ]);
  assert.deepEqual(phoneScreens(["index.html"]), []);
});
