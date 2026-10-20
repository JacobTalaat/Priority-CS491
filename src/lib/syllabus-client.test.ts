import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR } from "./api-client";
import { NOT_AVAILABLE_YET, SYLLABUS_MAX_BYTES, isPdf, uploadSyllabus, validateSyllabusFile } from "./syllabus-client";

function pdf(name = "syllabus.pdf", size = 1000, type = "application/pdf") {
  return new File([new Uint8Array(size)], name, { type });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: { getItem: () => "app-token" } });
  fetchMock = vi.fn(async () => Response.json({ suggestions: { categories: [] } }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPdf", () => {
  it("accepts the PDF type or a .pdf name", () => {
    expect(isPdf({ name: "a.pdf", type: "" })).toBe(true);
    expect(isPdf({ name: "SYLLABUS.PDF", type: "" })).toBe(true);
    expect(isPdf({ name: "syllabus", type: "application/pdf" })).toBe(true);
  });

  it("rejects other files", () => {
    expect(isPdf({ name: "syllabus.docx", type: "application/msword" })).toBe(false);
  });
});

describe("validateSyllabusFile", () => {
  it("passes a normal PDF", () => {
    expect(validateSyllabusFile(pdf())).toBeNull();
  });

  it("asks for a file", () => {
    expect(validateSyllabusFile(null)).toBe("Choose your syllabus PDF.");
  });

  it("rejects non-PDF, empty, and oversized files", () => {
    expect(validateSyllabusFile(pdf("notes.docx", 10, "application/msword"))).toMatch(/isn't a PDF/);
    expect(validateSyllabusFile(pdf("empty.pdf", 0))).toBe("That PDF is empty.");
    expect(validateSyllabusFile(pdf("big.pdf", SYLLABUS_MAX_BYTES + 1))).toMatch(/over 10 MB/);
  });
});

describe("uploadSyllabus", () => {
  it("posts the PDF as multipart form data to the course's syllabus route", async () => {
    const file = pdf();
    await uploadSyllabus("course/1", file);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/courses/course%2F1/syllabus");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer app-token" });
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
  });

  it("returns the AI suggestions on success", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ suggestions: { categories: [{ name: "Exams", weight: 60 }] } }));
    expect(await uploadSyllabus("c1", pdf())).toEqual({
      ok: true,
      suggestions: { categories: [{ name: "Exams", weight: 60 }] },
    });
  });

  it("explains that reading isn't available when the route doesn't exist yet", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>404</html>", { status: 404 }));
    expect(await uploadSyllabus("c1", pdf())).toEqual({ ok: false, status: 404, error: NOT_AVAILABLE_YET });
  });

  it("shows the API's message, like a scanned PDF", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "This PDF is a scan, so there's no text to read." }, { status: 422 }),
    );
    expect(await uploadSyllabus("c1", pdf())).toEqual({
      ok: false,
      status: 422,
      error: "This PDF is a scan, so there's no text to read.",
    });
  });

  it("keeps a real course-not-found error from the API", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Course not found" }, { status: 404 }));
    const result = await uploadSyllabus("c1", pdf());
    expect(!result.ok && result.error).toBe("Course not found");
  });

  it("explains an expired session", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Unauthorized" }, { status: 401 }));
    const result = await uploadSyllabus("c1", pdf());
    expect(!result.ok && result.error).toMatch(/session expired/);
  });

  it("reports network failures without throwing", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await uploadSyllabus("c1", pdf())).toEqual({ ok: false, status: 0, error: NETWORK_ERROR });
  });
});
