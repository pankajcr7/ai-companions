/** The preview page that builds a React or Next.js app in the browser (the server decides for sure). */
export const APP_PAGE = "__app__";

const NOT_SOURCE = /(^|\/)(node_modules|\.next|\.git|dist|build|out)\//;

/** Whether a project looks like a React or Next.js app: a package.json with JSX, a Next.js or Vite config, or a React starting file. */
export function isAppProject(paths: string[]): boolean {
  const src = paths.filter((p) => !NOT_SOURCE.test(p));
  if (!src.some((p) => /(^|\/)package\.json$/.test(p))) return false;
  return src.some((p) => /\.(jsx|tsx)$/.test(p) || /(^|\/)(next|vite)\.config\.(js|mjs|cjs|ts)$/.test(p) || /(^|\/)src\/(index|main)\.js$/.test(p) || /(^|\/)(app|pages)\/(.+\/)?(page|index)\.(js|ts)$/.test(p));
}
