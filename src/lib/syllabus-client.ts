import { NETWORK_ERROR } from "./api-client";
import { getToken } from "./session";

export const SYLLABUS_MAX_BYTES = 10 * 1024 * 1024;

// What the AI reader (PR-042) suggests. Kept loose here; the weights form owns the shape.
export type SyllabusSuggestions = Record<string, unknown>;

export type SyllabusUploadResult =
  | { ok: true; suggestions: SyllabusSuggestions }
  | { ok: false; status: number; error: string };

export const NOT_AVAILABLE_YET =
  "Reading syllabi isn't turned on yet. You can enter your weights by hand below for now.";

export function isPdf(file: Pick<File, "name" | "type">): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

// Returns an error message for the file field, or null when the file can be sent.
export function validateSyllabusFile(file: File | null): string | null {
  if (!file) {
    return "Choose your syllabus PDF.";
  }
  if (!isPdf(file)) {
    return "That isn't a PDF. Download the syllabus from Canvas as a PDF and try again.";
  }
  if (file.size === 0) {
    return "That PDF is empty.";
  }
  if (file.size > SYLLABUS_MAX_BYTES) {
    return "That PDF is over 10 MB. Try a smaller copy of the syllabus.";
  }
  return null;
}

// Proposed contract for PR-040: multipart POST with the PDF in a `file` field, answered
// with the AI's suggestions. Sent with fetch directly because apiRequest only sends JSON.
export async function uploadSyllabus(courseId: string, file: File): Promise<SyllabusUploadResult> {
  const body = new FormData();
  body.append("file", file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/syllabus`, {
      method: "POST",
      headers,
      body,
    });
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }

  const payload: unknown = await response.json().catch(() => null);
  const apiError =
    typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : null;

  if (response.ok) {
    const suggestions =
      typeof payload === "object" &&
      payload !== null &&
      "suggestions" in payload &&
      typeof payload.suggestions === "object" &&
      payload.suggestions !== null
        ? (payload.suggestions as SyllabusSuggestions)
        : {};
    return { ok: true, suggestions };
  }
  // A 404 with no JSON error means the route itself doesn't exist yet, not a missing course.
  if (response.status === 404 && !apiError) {
    return { ok: false, status: 404, error: NOT_AVAILABLE_YET };
  }
  if (response.status === 401) {
    return { ok: false, status: 401, error: "Your Priority session expired. Log out and log back in, then try again." };
  }
  return { ok: false, status: response.status, error: apiError ?? `Something went wrong (${response.status}). Try again.` };
}
