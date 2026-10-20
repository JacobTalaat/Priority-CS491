import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSessionFindUnique,
  mockCourseFindFirst,
  mockSyllabusUpsert,
  mockReadSyllabusPdf,
} = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockSyllabusUpsert: vi.fn(),
  mockReadSyllabusPdf: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    course: { findFirst: mockCourseFindFirst },
    courseSyllabus: { upsert: mockSyllabusUpsert },
  },
}));

vi.mock("@/lib/syllabus-text", () => ({
  SYLLABUS_MAX_BYTES: 10 * 1024 * 1024,
  readSyllabusPdf: mockReadSyllabusPdf,
}));

import { POST } from "./route";

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

function pdfBytes(size = 100): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(size));
}

const STORAGE_FILE_SIZE = 100;

function fileOfSize(size: number): File {
  const file = new File([pdfBytes()], "syllabus.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function stubbedFormRequest(entry: File): Request {
  const form = new FormData();
  form.set("file", entry);
  return {
    headers: new Headers({ Authorization: "Bearer session-token" }),
    formData: () => Promise.resolve(form),
  } as unknown as Request;
}

function multipartRequest(
  options: {
    entry?: File | string | null;
    filePath?: string;
    fileBytes?: Uint8Array<ArrayBuffer>;
    withSession?: boolean;
    contentLength?: string;
    rawBody?: Uint8Array<ArrayBuffer>;
    contentType?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (options.withSession !== false) {
    headers.set("Authorization", "Bearer session-token");
  }
  if (options.contentLength) {
    headers.set("Content-Length", options.contentLength);
  }
  if (options.rawBody) {
    headers.set("Content-Type", options.contentType ?? "text/plain");
    return new Request("http://localhost/api/courses/course-1/syllabus", {
      method: "POST",
      headers,
      body: options.rawBody,
    });
  }
  const form = new FormData();
  if (options.entry !== null) {
    if (typeof options.entry === "string") {
      form.set("file", options.entry);
    } else {
      form.set(
        "file",
        new File([options.fileBytes ?? pdfBytes()], options.filePath ?? "syllabus.pdf", {
          type: "application/pdf",
        }),
      );
    }
  }
  return new Request("http://localhost/api/courses/course-1/syllabus", {
    method: "POST",
    headers,
    body: form,
  });
}

const context = { params: Promise.resolve({ courseId: "course-1" }) };

const okResult = { ok: true as const, text: "Syllabus text", pageCount: 12 };
const failResult = (reason: string) => ({ ok: false as const, reason });

describe("POST /api/courses/[courseId]/syllabus", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockCourseFindFirst.mockReset().mockResolvedValue({ id: "course-1" });
    mockSyllabusUpsert.mockReset().mockResolvedValue({});
    mockReadSyllabusPdf.mockReset().mockResolvedValue(okResult);
  });

  it("stores extracted text for the authenticated student's current course and returns metadata only", async () => {
    const response = await POST(multipartRequest(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCourseFindFirst).toHaveBeenCalledWith({
      where: { id: "course-1", userId: "user-1", isCurrent: true },
      select: { id: true },
    });
    expect(mockSyllabusUpsert).toHaveBeenCalledWith({
      where: { courseId: "course-1" },
      create: expect.objectContaining({
        courseId: "course-1",
        fileName: "syllabus.pdf",
        sizeBytes: STORAGE_FILE_SIZE,
        pageCount: 12,
        text: "Syllabus text",
        extractedAt: expect.any(Date),
      }),
      update: expect.objectContaining({
        fileName: "syllabus.pdf",
        sizeBytes: STORAGE_FILE_SIZE,
        pageCount: 12,
        text: "Syllabus text",
        extractedAt: expect.any(Date),
      }),
    });
    expect(body).toEqual({
      syllabus: {
        courseId: "course-1",
        fileName: "syllabus.pdf",
        sizeBytes: STORAGE_FILE_SIZE,
        pageCount: 12,
        characterCount: 13,
        extractedAt: expect.any(String),
      },
    });
  });

  it("replaces a saved syllabus through the upsert update branch", async () => {
    await POST(multipartRequest(), context);
    await POST(multipartRequest(), context);
    expect(mockSyllabusUpsert).toHaveBeenCalledTimes(2);
    const second = mockSyllabusUpsert.mock.calls[1][0];
    expect(second.where).toEqual({ courseId: "course-1" });
    expect(second.update.fileName).toBe("syllabus.pdf");
    expect(second.update).not.toHaveProperty("courseId");
    expect({ ...second.create, courseId: undefined }).toEqual({ ...second.update, courseId: undefined });
  });

  it("rejects a file whose contents are not a PDF", async () => {
    mockReadSyllabusPdf.mockResolvedValue(failResult("not-pdf"));
    const response = await POST(multipartRequest(), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "That isn't a PDF. Download the syllabus from Canvas as a PDF and try again.",
    });
    expect(mockSyllabusUpsert).not.toHaveBeenCalled();
  });

  it("uses syllabus.pdf when the uploaded file has an empty name", async () => {
    const response = await POST(stubbedFormRequest(new File([pdfBytes()], "", { type: "application/pdf" })), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mockSyllabusUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ fileName: "syllabus.pdf" }),
        update: expect.objectContaining({ fileName: "syllabus.pdf" }),
      }),
    );
    expect(body.syllabus.fileName).toBe("syllabus.pdf");
  });

  it("truncates a very long file name to 255 characters", async () => {
    const response = await POST(multipartRequest({ filePath: "x".repeat(300) }), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mockSyllabusUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ fileName: "x".repeat(255) }),
        update: expect.objectContaining({ fileName: "x".repeat(255) }),
      }),
    );
    expect(body.syllabus.fileName).toBe("x".repeat(255));
  });

  it("rejects a non-multipart body", async () => {
    const response = await POST(
      multipartRequest({ rawBody: pdfBytes(), contentType: "text/plain" }),
      context,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Send the syllabus as multipart/form-data with the PDF in a "file" field.',
    });
    expect(mockReadSyllabusPdf).not.toHaveBeenCalled();
    expect(mockSyllabusUpsert).not.toHaveBeenCalled();
  });

  it("rejects a missing file entry", async () => {
    const response = await POST(multipartRequest({ entry: null }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Choose your syllabus PDF." });
    expect(mockReadSyllabusPdf).not.toHaveBeenCalled();
  });

  it("rejects a plain string file entry", async () => {
    const response = await POST(multipartRequest({ entry: "not-a-file" }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Choose your syllabus PDF." });
    expect(mockReadSyllabusPdf).not.toHaveBeenCalled();
  });

  it("rejects an empty file", async () => {
    const response = await POST(multipartRequest({ fileBytes: new Uint8Array(0) as Uint8Array<ArrayBuffer> }), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "That PDF is empty." });
    expect(mockReadSyllabusPdf).not.toHaveBeenCalled();
    expect(mockSyllabusUpsert).not.toHaveBeenCalled();
  });

  it("rejects a file over 10 MB before reading it", async () => {
    const form = new FormData();
    form.set("file", fileOfSize(10 * 1024 * 1024 + 1));
    const headers = new Headers({ Authorization: "Bearer session-token" });
    const request = {
      headers,
      formData: () => Promise.resolve(form),
    } as unknown as Request;
    const response = await POST(request, context);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "That PDF is over 10 MB. Try a smaller copy of the syllabus.",
    });
    expect(mockReadSyllabusPdf).not.toHaveBeenCalled();
    expect(mockSyllabusUpsert).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared Content-Length before touching the course", async () => {
    const response = await POST(
      multipartRequest({ contentLength: String(12 * 1024 * 1024 + 1) }),
      context,
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "That PDF is over 10 MB. Try a smaller copy of the syllabus.",
    });
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
    expect(mockReadSyllabusPdf).not.toHaveBeenCalled();
  });

  it("accepts a file of exactly 10 MB", async () => {
    const response = await POST(stubbedFormRequest(fileOfSize(10 * 1024 * 1024)), context);
    expect(response.status).toBe(200);
    expect(mockReadSyllabusPdf).toHaveBeenCalledTimes(1);
    expect(mockSyllabusUpsert).toHaveBeenCalledTimes(1);
  });

  it("reports unreadable, encrypted, and overly large PDFs as unprocessable", async () => {
    mockReadSyllabusPdf.mockResolvedValue(failResult("unreadable"));
    const unreadable = await POST(multipartRequest(), context);
    expect(unreadable.status).toBe(422);
    await expect(unreadable.json()).resolves.toEqual({
      error: "That PDF could not be read. Download a fresh copy of the syllabus and try again.",
    });

    mockReadSyllabusPdf.mockResolvedValue(failResult("encrypted"));
    const encrypted = await POST(multipartRequest(), context);
    expect(encrypted.status).toBe(422);
    await expect(encrypted.json()).resolves.toEqual({
      error: "That PDF is password-protected. Upload a copy without a password.",
    });

    mockReadSyllabusPdf.mockResolvedValue(failResult("too-many-pages"));
    const tooManyPages = await POST(multipartRequest(), context);
    expect(tooManyPages.status).toBe(422);
    await expect(tooManyPages.json()).resolves.toEqual({
      error: "That PDF has more than 50 pages. Upload just the syllabus.",
    });

    expect(mockSyllabusUpsert).not.toHaveBeenCalled();
  });

  it("reports scanned PDFs with the scanned message and saves nothing", async () => {
    mockReadSyllabusPdf.mockResolvedValue(failResult("no-text"));
    const response = await POST(multipartRequest(), context);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error:
        "This PDF looks like a scanned image, so Priority can't read its text. Upload a PDF with selectable text, or enter your weights by hand.",
    });
    expect(mockSyllabusUpsert).not.toHaveBeenCalled();
  });

  it("does not save a syllabus for another user's or a non-current course", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const response = await POST(multipartRequest(), context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Current course not found." });
    expect(mockReadSyllabusPdf).not.toHaveBeenCalled();
    expect(mockSyllabusUpsert).not.toHaveBeenCalled();
  });

  it("requires an app session", async () => {
    const response = await POST(multipartRequest({ withSession: false }), context);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
    expect(mockReadSyllabusPdf).not.toHaveBeenCalled();
  });

  it("forces dynamic rendering", async () => {
    const { dynamic } = await import("./route");
    expect(dynamic).toBe("force-dynamic");
  });
});
