import { strFromU8, unzipSync } from "fflate";
import { extractText as pdfText, getDocumentProxy } from "unpdf";
import type { Kind } from "./detect.js";

export const TEXT_CAP = 200_000;
const cap = (s: string) => s.slice(0, TEXT_CAP);
const xmlText = (xml: string) => xml.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tags = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}[ >][\\s\\S]*?</${tag}>`, "g"))].map((m) => m[0]);

function word(files: Record<string, Uint8Array>) {
  return tags(strFromU8(files["word/document.xml"]), "w:p").map(xmlText).filter((p) => p.trim()).join("\n");
}

function excel(files: Record<string, Uint8Array>) {
  const shared = files["xl/sharedStrings.xml"] ? tags(strFromU8(files["xl/sharedStrings.xml"]), "si").map(xmlText) : [];
  const names = [...strFromU8(files["xl/workbook.xml"]).matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]));
  return names
    .map((name, i) => {
      const sheet = files[`xl/worksheets/sheet${i + 1}.xml`];
      if (!sheet) return "";
      const rows = tags(strFromU8(sheet), "row").map((row) =>
        [...row.matchAll(/<c ([^>]*)>(?:[\s\S]*?<v>([\s\S]*?)<\/v>)?[\s\S]*?<\/c>/g)].map((c) => (/t="s"/.test(c[1]) ? (shared[Number(c[2])] ?? "") : xmlText(c[2] ?? ""))).join(", "),
      );
      return `Sheet ${name}:\n${rows.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function slides(files: Record<string, Uint8Array>) {
  return Object.keys(files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((f, i) => `Slide ${i + 1}:\n${[...strFromU8(files[f]).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => xmlText(m[1])).join(" ")}`)
    .join("\n\n");
}

export async function extractText(kind: Kind, mime: string, data: Buffer): Promise<{ text: string | null; pages: number | null; scanned: boolean }> {
  if (kind === "image") return { text: null, pages: null, scanned: false };
  if (kind === "text") return { text: cap(data.toString("utf8")), pages: null, scanned: false };
  if (kind === "pdf") {
    try {
      const doc = await getDocumentProxy(new Uint8Array(data));
      const { totalPages, text } = await pdfText(doc, { mergePages: true });
      const clean = (text as string).trim();
      return { text: cap(clean), pages: totalPages, scanned: clean.length === 0 };
    } catch {
      return { text: "", pages: null, scanned: true };
    }
  }
  const files = unzipSync(data, { filter: (f) => f.name.endsWith(".xml") });
  const text = mime.includes("wordprocessing") ? word(files) : mime.includes("spreadsheet") ? excel(files) : slides(files);
  return { text: cap(text), pages: null, scanned: false };
}
