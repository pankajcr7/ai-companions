import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";
import { getDocumentProxy } from "unpdf";
import type { Kind } from "./detect.js";

export const TEXT_CAP = 200_000;
/** Office files are ZIPs: an entry may claim to inflate to gigabytes. Anything bigger than this is skipped unread. */
const MAX_XML_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 40 * 1024 * 1024;
const MAX_PDF_PAGES = 300;
const cap = (s: string) => s.slice(0, TEXT_CAP);
const decode = (xml: string) => xml.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const xmlText = (xml: string) => decode(xml.replace(/<[^>]*>/g, ""));
/** The pieces of `xml` that end with `</tag>`: a linear split, so an unclosed or malicious tag can't make it slow. */
const pieces = (xml: string, tag: string) => xml.split(`</${tag}>`).slice(0, -1);

function word(files: Record<string, Uint8Array>) {
  const doc = files["word/document.xml"];
  return doc ? pieces(strFromU8(doc), "w:p").map(xmlText).filter((p) => p.trim()).join("\n") : "";
}

/** Sheet name → its XML file, through the workbook's links (sheet order isn't sheetN order). */
function sheetFiles(files: Record<string, Uint8Array>) {
  const rels = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*?\bId="([^"]*)"[^>]*?\bTarget="([^"]*)"/g)].map((m) => [m[1], m[2].replace(/^\/?xl\//, "")]));
  return [...strFromU8(files["xl/workbook.xml"]).matchAll(/<sheet\b([^>]*)>/g)].map((m, i) => {
    const name = decode(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? `Sheet${i + 1}`);
    const rid = /\br:id="([^"]*)"/.exec(m[1])?.[1];
    return { name, path: `xl/${(rid && target.get(rid)) || `worksheets/sheet${i + 1}.xml`}` };
  });
}

function excel(files: Record<string, Uint8Array>) {
  const shared = files["xl/sharedStrings.xml"] ? pieces(strFromU8(files["xl/sharedStrings.xml"]), "si").map(xmlText) : [];
  return sheetFiles(files)
    .map(({ name, path }) => {
      const sheet = files[path];
      if (!sheet) return "";
      const rows = pieces(strFromU8(sheet), "row").map((row) =>
        // One cell is either self-closing (empty) or ends at its own </c>: no nested lazy groups.
        [...row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
          .map(([, attrs, body = ""]) => {
            if (/\bt="s"/.test(attrs)) return shared[Number(/<v>([^<]*)<\/v>/.exec(body)?.[1])] ?? "";
            if (/\bt="inlineStr"/.test(attrs)) return xmlText(body);
            return decode(/<v>([^<]*)<\/v>/.exec(body)?.[1] ?? "");
          })
          .join(", "),
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
    .map((f, i) => `Slide ${i + 1}:\n${[...strFromU8(files[f]).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decode(m[1])).join(" ")}`)
    .join("\n\n");
}

/** Only the XML parts, and only if they inflate to a sane size; a zip bomb gets nothing back. */
function unzipXml(data: Buffer): Record<string, Uint8Array> | null {
  let total = 0;
  let bomb = false;
  const files = unzipSync(data, {
    filter: (f: UnzipFileInfo) => {
      if (!f.name.endsWith(".xml") && !f.name.endsWith(".rels")) return false;
      total += f.originalSize;
      if (f.originalSize > MAX_XML_BYTES || total > MAX_TOTAL_XML_BYTES) bomb = true;
      return !bomb;
    },
  });
  return bomb ? null : files;
}

export async function extractText(kind: Kind, mime: string, data: Buffer): Promise<{ text: string | null; pages: number | null; scanned: boolean }> {
  if (kind === "image") return { text: null, pages: null, scanned: false };
  if (kind === "text") return { text: cap(data.toString("utf8")), pages: null, scanned: false };
  if (kind === "pdf") {
    try {
      // ponytail: runs in-process with page and size caps; move to a worker with resourceLimits if hostile PDFs become a real problem.
      const doc = await getDocumentProxy(new Uint8Array(data));
      const parts: string[] = [];
      let length = 0;
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES) && length < TEXT_CAP; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
        parts.push(text);
        length += text.length;
      }
      const clean = parts.join("\n").trim();
      return { text: cap(clean), pages: doc.numPages, scanned: clean.length === 0 };
    } catch {
      return { text: "", pages: null, scanned: true };
    }
  }
  try {
    const files = unzipXml(data);
    if (!files) return { text: "", pages: null, scanned: false };
    const text = mime.includes("wordprocessing") ? word(files) : mime.includes("spreadsheet") ? excel(files) : slides(files);
    return { text: cap(text), pages: null, scanned: false };
  } catch {
    return { text: "", pages: null, scanned: false };
  }
}
