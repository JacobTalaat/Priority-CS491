import { extractText, getDocumentProxy } from "unpdf";

export const SYLLABUS_MAX_BYTES = 10 * 1024 * 1024;

const SYLLABUS_MAX_PAGES = 50;
const MIN_TEXT_CHARS_PER_PAGE = 100;

export type SyllabusReadFailure =
  | "not-pdf"
  | "unreadable"
  | "encrypted"
  | "too-many-pages"
  | "no-text";

export type SyllabusReadResult =
  | { ok: true; text: string; pageCount: number }
  | { ok: false; reason: SyllabusReadFailure };

export async function readSyllabusPdf(bytes: Uint8Array): Promise<SyllabusReadResult> {
  if (bytes.length < 5) {
    return { ok: false, reason: "not-pdf" };
  }
  const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  if (header !== "%PDF-") {
    return { ok: false, reason: "not-pdf" };
  }

  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      return { ok: false, reason: "encrypted" };
    }
    return { ok: false, reason: "unreadable" };
  }

  try {
    if (pdf.numPages > SYLLABUS_MAX_PAGES) {
      return { ok: false, reason: "too-many-pages" };
    }

    let extracted: { totalPages: number; text: string };
    try {
      extracted = await extractText(pdf, { mergePages: true });
    } catch {
      return { ok: false, reason: "unreadable" };
    }

    const text = extracted.text.replaceAll("\u0000", "").trim();
    if (text.replace(/\s/g, "").length < pdf.numPages * MIN_TEXT_CHARS_PER_PAGE) {
      return { ok: false, reason: "no-text" };
    }
    return { ok: true, text, pageCount: pdf.numPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
