import { unzipSync } from "fflate";

export type Kind = "image" | "pdf" | "office" | "text";
const OFFICE: Record<string, string> = {
  "word/document.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "xl/workbook.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "ppt/presentation.xml": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const starts = (d: Buffer, hex: string) => d.subarray(0, hex.length / 2).equals(Buffer.from(hex, "hex"));

/** The file's real type from its first bytes; the name never decides. SVG and any other UTF-8 text is "text". */
export function detect(_name: string, d: Buffer): { kind: Kind; mime: string } | null {
  if (starts(d, "89504e470d0a1a0a")) return { kind: "image", mime: "image/png" };
  if (starts(d, "ffd8ff")) return { kind: "image", mime: "image/jpeg" };
  if (d.subarray(0, 4).toString("latin1") === "GIF8") return { kind: "image", mime: "image/gif" };
  if (d.subarray(0, 4).toString("latin1") === "RIFF" && d.subarray(8, 12).toString("latin1") === "WEBP") return { kind: "image", mime: "image/webp" };
  if (d.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", mime: "application/pdf" };
  if (starts(d, "504b0304")) {
    try {
      const names = Object.keys(unzipSync(d, { filter: (f) => f.name in OFFICE }));
      return names[0] ? { kind: "office", mime: OFFICE[names[0]] } : null;
    } catch {
      return null;
    }
  }
  const head = d.subarray(0, 8192);
  if (head.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, head.length - (head.length === 8192 ? 4 : 0)));
    return { kind: "text", mime: "text/plain" };
  } catch {
    return null;
  }
}
