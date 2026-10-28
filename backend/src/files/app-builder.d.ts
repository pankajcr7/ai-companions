/** Project files by path relative to the app's root; assets (pictures, fonts) may have empty contents. */
export type AppFiles = Record<string, string>;
export type BuildError = { file: string; line: number; column: number; text: string };
export type BuiltApp = {
  kind: "react" | "next" | "remotion";
  js: string;
  css: string;
  /** The page's starting markup (index.html's body without scripts, or a root element). */
  body: string;
  /** Outside stylesheets from index.html's head. */
  head: string;
  title: string;
  /** The Tailwind major version to compile the CSS with in the browser, or 0. */
  tailwind: 0 | 3 | 4;
  /** Parts that can't run in a browser preview (Next.js API routes, server actions). */
  notes: string[];
  errors: BuildError[];
};
export function buildApp(esbuild: unknown, files: AppFiles, options: { assetBase: string }): Promise<BuiltApp>;
export function startPreview(options: { esbuild: unknown; wasmURL: string; files: AppFiles; assetBase: string }): Promise<void>;
