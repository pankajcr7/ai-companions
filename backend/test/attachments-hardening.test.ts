import { strToU8, zipSync } from "fflate";
import { expect, test } from "vitest";
import { detect } from "../src/attachments/detect.js";
import { extractText } from "../src/attachments/extract.js";
import { office } from "./attachments-fixtures.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ms = async (fn: () => Promise<unknown>) => {
  const start = Date.now();
  await fn();
  return Date.now() - start;
};

test("a spreadsheet built to stall the reader is read quickly (no catastrophic backtracking)", async () => {
  const row = `<row r="1">${"<c ><v>1</v>".repeat(800)}</row>`;
  const evil = office({ "xl/workbook.xml": '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>', "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${row}</sheetData></worksheet>` });
  expect(await ms(() => extractText("office", XLSX_MIME, evil))).toBeLessThan(1000);
  const words = office({ "word/document.xml": `<w:document>${"<w:p>".repeat(20_000)}</w:document>` });
  expect(await ms(() => extractText("office", DOCX_MIME, words))).toBeLessThan(1000);
});

test("a zip bomb is refused without inflating it", async () => {
  // 40 MB of the same character compresses to a few dozen KB.
  const bomb = Buffer.from(zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(`<w:p><w:t>${"a".repeat(40 * 1024 * 1024)}</w:t></w:p>`) }));
  expect(bomb.length).toBeLessThan(1024 * 1024);
  expect(detect("big.docx", bomb)?.kind).toBe("office");
  const out = await extractText("office", DOCX_MIME, bomb);
  expect(out.text).toBe("");
});

test("non-English text files over 8 KB are text, whatever the cut at 8 KB", () => {
  expect(detect("notes.txt", Buffer.from("日本語のテキスト。".repeat(2000)))).toEqual({ kind: "text", mime: "text/plain" });
  for (let pad = 0; pad < 4; pad++) expect(detect("prices.txt", Buffer.from("x".repeat(pad) + "Цена хлеба: 45 рублей\n".repeat(600)))).toEqual({ kind: "text", mime: "text/plain" });
});

test("spreadsheet cells: empty styled cells, inline strings, and sheet order from the workbook links", async () => {
  const xlsx = office({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Menu" sheetId="1" r:id="rId7"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId7" Target="worksheets/sheet3.xml"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><t>Price</t></si></sst>",
    "xl/worksheets/sheet3.xml": '<worksheet><sheetData><row r="1"><c r="A1" s="2"/><c r="B1" t="s"><v>0</v></c><c r="C1"><v>12.5</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Soup</t></is></c><c r="B2"><v>4</v></c></row></sheetData></worksheet>',
  });
  expect((await extractText("office", XLSX_MIME, xlsx)).text).toBe("Sheet Menu:\n, Price, 12.5\nSoup, 4");
});
