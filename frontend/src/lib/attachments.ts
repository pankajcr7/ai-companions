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
export const filesFromClipboard = (e: { clipboardData: DataTransfer | null }) => [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
