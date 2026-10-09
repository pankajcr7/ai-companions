export const MAX_FILES = 10;
export const MAX_BYTES = 10 * 1024 * 1024;
export const VIEW_MAX_SIDE = 2000;
export const VIEW_MAX_BYTES = 4 * 1024 * 1024;

export function fitWithin(w: number, h: number, max = VIEW_MAX_SIDE) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}
export const needsViewCopy = (size: number, w: number, h: number) => size > VIEW_MAX_BYTES || Math.max(w, h) > VIEW_MAX_SIDE;
export const refusal = (f: { name: string; size: number }) => (f.size > MAX_BYTES ? `${f.name} is over 10 MB` : null);
export const filesFromClipboard = (e: { clipboardData: DataTransfer | null }) => {
  const when = new Date();
  return [...(e.clipboardData?.items ?? [])]
    .filter((i) => i.kind === "file")
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f)
    .map((f, n) => {
      const name = pastedName(f, when, n);
      return name === f.name ? f : new File([f], name, { type: f.type });
    });
};

const pad = (n: number) => String(n).padStart(2, "0");
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
/** Browsers name every pasted picture "image.png"; give each its own name so companions can tell them apart. */
export function pastedName(file: { name: string; type: string }, when: Date, n: number): string {
  if (file.name && file.name !== "image.png") return file.name;
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  return `screenshot-${stamp}${n ? `-${n + 1}` : ""}.${EXT[file.type] ?? "png"}`;
}
