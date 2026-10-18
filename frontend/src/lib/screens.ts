export type PhoneScreen = { path: string; name: string };

/** The app screens in a project: HTML files directly in screens/, in number order, named from the file name ("01-order-history.html" → "Order history"). */
export function phoneScreens(paths: string[]): PhoneScreen[] {
  return paths
    .filter((p) => /^screens\/[^/]+\.html?$/i.test(p))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), undefined, { numeric: true }))
    .map((path) => {
      const words = path.replace(/^screens\//i, "").replace(/\.html?$/i, "").replace(/^\d+[-_ ]*/, "").replace(/[-_]+/g, " ").trim().toLowerCase();
      return { path, name: words ? words[0].toUpperCase() + words.slice(1) : path };
    });
}
