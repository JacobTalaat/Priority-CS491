import { describe, expect, it } from "vitest";
import { readSyllabusPdf } from "./syllabus-text";

function toBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function pdfString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdf(pageTexts: string[], trailerExtras: Record<string, string> = {}): Uint8Array {
  const parts: string[] = [];
  const offsets: number[] = [];
  let position = 0;

  const push = (chunk: string) => {
    parts.push(chunk);
    position += toBytes(chunk).length;
  };

  const objectCount = 3 + pageTexts.length * 2 + Object.keys(trailerExtras).length;
  const pageIds = Array.from(pageTexts, (_, i) => 4 + i * 2);
  const extraObjectIds = Object.keys(trailerExtras).map((_, i) => 4 + pageTexts.length * 2 + i);

  const object = (id: number, body: string) => {
    offsets[id] = position;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  push("%PDF-1.4\n");

  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`,
  );
  object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pageTexts.forEach((pageText, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const chunks = [];
    for (let j = 0; j < pageText.length; j += 60) {
      chunks.push(`(${pdfString(pageText.slice(j, j + 60))}) Tj 0 -14 Td`);
    }
    const stream = chunks.length === 0 ? "" : `BT /F1 10 Tf 72 750 Td ${chunks.join(" ")} ET`;
    object(
      contentId,
      `<< /Length ${toBytes(stream).length} >>\nstream\n${stream}\nendstream`,
    );
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] >>`,
    );
  });

  extraObjectIds.forEach((id, i) => {
    object(id, Object.values(trailerExtras)[i]);
  });

  const xrefStart = position;
  const xref = [
    "xref",
    `0 ${objectCount + 1}`,
    "0000000000 65535 f ",
    ...Array.from(
      { length: objectCount },
      (_, i) => `${String(offsets[i + 1]).padStart(10, "0")} 00000 n `,
    ),
  ].join("\n");
  push(`${xref}\n`);

  const trailerPairs = Object.keys(trailerExtras)
    .map((key, i) => `/${key} ${extraObjectIds[i]} 0 R`)
    .join(" ");
  const trailer = `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R${trailerPairs ? ` ${trailerPairs}` : ""} >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  push(trailer);

  return toBytes(parts.join(""));
}

const salt = "01".repeat(16);
const ownerKey = "\\001".repeat(32);
const userKey = "\\002".repeat(32);
const encryptDictionary =
  "<< /Filter /Standard /V 2 /R 3 /Length 128 /O (" +
  ownerKey +
  ") /U (" +
  userKey +
  ") /P -1 >>";
const encryptTrailer = { Encrypt: encryptDictionary, ID: `[ <${salt}> <${salt}> ]` };

describe("readSyllabusPdf", () => {
  it("extracts text and page count from a one-page text PDF", async () => {
    const result = await readSyllabusPdf(buildPdf(["A".repeat(120)]));
    expect(result).toEqual({ ok: true, text: "A".repeat(60) + "\n" + "A".repeat(60), pageCount: 1 });
  });

  it("joins text across a multi-page PDF", async () => {
    const result = await readSyllabusPdf(
      buildPdf(["First page: " + "F".repeat(100), "Second page: " + "S".repeat(100)]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.pageCount).toBe(2);
    const stripped = result.text.replace(/\s/g, "");
    expect(result.text).toContain("First page: ");
    expect(result.text).toContain("Second page: ");
    expect(stripped).toContain("Firstpage:" + "F".repeat(100));
    expect(stripped).toContain("Secondpage:" + "S".repeat(100));
    expect(stripped).toContain("F".repeat(100) + "Secondpage:");
  });

  it("rejects bytes that do not start with %PDF-", async () => {
    await expect(readSyllabusPdf(toBytes("plain text file"))).resolves.toEqual({
      ok: false,
      reason: "not-pdf",
    });
    await expect(readSyllabusPdf(toBytes("\x89PNG\r\n\x1a\n"))).resolves.toEqual({
      ok: false,
      reason: "not-pdf",
    });
    await expect(readSyllabusPdf(toBytes("junk%PDF-1.4"))).resolves.toEqual({
      ok: false,
      reason: "not-pdf",
    });
    await expect(readSyllabusPdf(toBytes("%PD"))).resolves.toEqual({ ok: false, reason: "not-pdf" });
  });

  it("rejects corrupt PDF bytes as unreadable", async () => {
    await expect(readSyllabusPdf(toBytes("%PDF-1.7\n" + "\u0012garbage".repeat(40)))).resolves.toEqual(
      { ok: false, reason: "unreadable" },
    );
  });

  it("rejects password-protected PDFs as encrypted", async () => {
    await expect(readSyllabusPdf(buildPdf(["A".repeat(120)], encryptTrailer))).resolves.toEqual({
      ok: false,
      reason: "encrypted",
    });
  });

  it("rejects PDFs with more than 50 pages", async () => {
    const result = await readSyllabusPdf(buildPdf(Array.from({ length: 51 }, () => "")));
    expect(result).toEqual({ ok: false, reason: "too-many-pages" });
  });

  it("rejects PDFs whose pages carry no text", async () => {
    await expect(readSyllabusPdf(buildPdf([""]))).resolves.toEqual({ ok: false, reason: "no-text" });
  });

  it("rejects pages that only say Page N", async () => {
    await expect(
      readSyllabusPdf(buildPdf(["Page 1", "Page 2", "Page 3"])),
    ).resolves.toEqual({ ok: false, reason: "no-text" });
  });

  it("accepts exactly the minimum characters per page and rejects one less", async () => {
    await expect(readSyllabusPdf(buildPdf(["A".repeat(100)]))).resolves.toEqual({
      ok: true,
      text: "A".repeat(60) + "\n" + "A".repeat(40),
      pageCount: 1,
    });
    await expect(readSyllabusPdf(buildPdf(["A".repeat(99)]))).resolves.toEqual({
      ok: false,
      reason: "no-text",
    });
  });
});
