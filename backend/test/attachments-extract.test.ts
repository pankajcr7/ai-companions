import { expect, test } from "vitest";
import { detect } from "../src/attachments/detect.js";
import { extractText } from "../src/attachments/extract.js";
import { DOCX, GIF, JPEG, PNG, PPTX, WEBP, XLSX, pdf } from "./attachments-fixtures.js";

test("types come from the bytes, not the name", () => {
  expect(detect("a.png", PNG)).toEqual({ kind: "image", mime: "image/png" });
  expect(detect("photo.png", JPEG)).toEqual({ kind: "image", mime: "image/jpeg" });
  expect(detect("x.gif", GIF)).toEqual({ kind: "image", mime: "image/gif" });
  expect(detect("x.webp", WEBP)).toEqual({ kind: "image", mime: "image/webp" });
  expect(detect("menu.pdf", pdf("BT ET"))).toEqual({ kind: "pdf", mime: "application/pdf" });
  expect(detect("a.docx", DOCX)?.kind).toBe("office");
  expect(detect("notes.pdf", Buffer.from("just text\n"))).toEqual({ kind: "text", mime: "text/plain" });
  expect(detect("logo.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toEqual({ kind: "text", mime: "text/plain" });
  expect(detect("blob.bin", Buffer.from([0, 1, 2, 3, 0, 255]))).toBeNull();
});

test("text comes out of PDFs, Word, Excel and PowerPoint", async () => {
  const p = await extractText("pdf", "application/pdf", pdf("BT /F1 18 Tf 20 100 Td (Fresh bread daily) Tj ET"));
  expect(p).toMatchObject({ pages: 1, scanned: false });
  expect(p.text).toContain("Fresh bread daily");
  expect((await extractText("office", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", DOCX)).text).toBe("Fresh bread\nOpen 7&8");
  expect((await extractText("office", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", XLSX)).text).toBe("Sheet Prices:\nItem, 2.5\nCroissant, 3");
  expect((await extractText("office", "application/vnd.openxmlformats-officedocument.presentationml.presentation", PPTX)).text).toBe("Slide 1:\nHello world\n\nSlide 2:\nSecond");
});

test("a PDF without text is marked scanned; long text is capped", async () => {
  expect(await extractText("pdf", "application/pdf", pdf("0 0 m 10 10 l S"))).toMatchObject({ text: "", scanned: true, pages: 1 });
  const big = await extractText("text", "text/plain", Buffer.from("a".repeat(250_000)));
  expect(big.text!.length).toBe(200_000);
});
