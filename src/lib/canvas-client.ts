import { apiRequest } from "./api-client";
import type { ApiResult } from "./api-client";
import { getToken } from "./session";

// The API defaults to canvas.instructure.com, so the website sends NJIT's address unless
// the student changes it.
export const DEFAULT_CANVAS_URL = "https://njit.instructure.com";

export type CanvasStatus = {
  connected: boolean;
  baseUrl: string | null;
  checkedAt: string | null;
};

export type ImportedCourse = {
  id: string;
  name: string;
  courseCode: string | null;
  term: string | null;
  termEndsAt: string | null;
};

export type ImportedCoursesResponse = {
  connected: boolean;
  courses: ImportedCourse[];
};

export type CanvasUser = {
  id: number;
  name: string;
};

export type CanvasFormErrors = {
  token?: string;
  baseUrl?: string;
};

export function validateCanvasForm(canvasToken: string, baseUrl: string): CanvasFormErrors {
  const errors: CanvasFormErrors = {};
  if (!canvasToken.trim()) {
    errors.token = "Paste your Canvas access token.";
  }
  let url: URL | null = null;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:") {
    errors.baseUrl = `Use your school's Canvas address, like ${DEFAULT_CANVAS_URL}.`;
  }
  return errors;
}

export function getCanvasStatus() {
  return apiRequest<CanvasStatus>("/api/canvas/token", { token: getToken() });
}

export function connectCanvas(canvasToken: string, baseUrl: string) {
  return apiRequest<{ connected: true; canvasUser: CanvasUser }>("/api/canvas/token", {
    method: "POST",
    token: getToken(),
    body: { token: canvasToken.trim(), baseUrl: baseUrl.trim() },
  });
}

export function testCanvasConnection() {
  return apiRequest<{ ok: true; canvasUser: CanvasUser }>("/api/canvas/token/test", {
    method: "POST",
    token: getToken(),
  });
}

export function disconnectCanvas() {
  return apiRequest<{ connected: false }>("/api/canvas/token", { method: "DELETE", token: getToken() });
}

export function getImportedCourses() {
  return apiRequest<ImportedCoursesResponse>("/api/canvas/courses", { token: getToken() });
}

export function syncCanvas() {
  return apiRequest<{ courses: number }>("/api/canvas/sync", { method: "POST", token: getToken() });
}

// Shows the API's own message (e.g. "Canvas rejected this token"), except for an expired
// Priority session, which needs a different next step.
export function canvasErrorMessage(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (result.status === 401) {
    return "Your Priority session expired. Log out and log back in, then try again.";
  }
  return result.error;
}
