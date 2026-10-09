import { strToU8, zipSync } from "fflate";

export const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
export const JPEG = Buffer.from("ffd8ffe000104a464946", "hex");
export const GIF = Buffer.from("GIF89a....");
export const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
export const pdf = (body: string) =>
  Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${body.length}>>stream
${body}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`);
export const office = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries({ "[Content_Types].xml": "<Types/>", ...files }).map(([k, v]) => [k, strToU8(v)]))));
export const DOCX = office({ "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>Fresh bread</w:t></w:r></w:p><w:p><w:r><w:t>Open 7&amp;8</w:t></w:r></w:p></w:body></w:document>" });
export const XLSX = office({
  "xl/workbook.xml": '<workbook><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/sharedStrings.xml": "<sst><si><t>Item</t></si><si><t>Croissant</t></si></sst>",
  "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2.5</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>3</v></c></row></sheetData></worksheet>',
});
export const PPTX = office({ "ppt/presentation.xml": "<p:presentation/>", "ppt/slides/slide2.xml": "<p:sld><a:t>Second</a:t></p:sld>", "ppt/slides/slide1.xml": "<p:sld><a:t>Hello</a:t><a:t>world</a:t></p:sld>" });
