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

export type CalendarFeedStatus = {
  configured: boolean;
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

export function getCalendarFeedStatus() {
  return apiRequest<CalendarFeedStatus>("/api/canvas/calendar-feed", { token: getToken() });
}

export function saveCalendarFeed(feedUrl: string) {
  return apiRequest<CalendarFeedStatus>("/api/canvas/calendar-feed", {
    method: "POST",
    token: getToken(),
    body: { feedUrl: feedUrl.trim() },
  });
}

export function clearCalendarFeed() {
  return apiRequest<CalendarFeedStatus>("/api/canvas/calendar-feed", { method: "DELETE", token: getToken() });
}

export function getImportedCourses() {
  return apiRequest<ImportedCoursesResponse>("/api/canvas/courses", { token: getToken() });
}

// Shows the API's own message (e.g. "Canvas rejected this token"), except for an expired
// Priority session, which needs a different next step.
export function canvasErrorMessage(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (result.status === 401) {
    return "Your Priority session expired. Log out and log back in, then try again.";
  }
  return result.error;
}

export type SyncResult = {
  lastSyncedAt: string;
  courses: number;
  assignmentGroups: number;
  assignments: number;
  grades: number;
};

export function getLastSynced() {
  return apiRequest<{ lastSyncedAt: string | null }>("/api/canvas/sync", { token: getToken() });
}

export function syncNow() {
  return apiRequest<SyncResult>("/api/canvas/sync", { method: "POST", token: getToken() });
}

function plural(count: number, word: string) {
  if (count === 1) {
    return `1 ${word}`;
  }
  return `${count} ${word.endsWith("s") ? `${word}es` : `${word}s`}`;
}

export function syncSummary(result: SyncResult): string {
  return `Synced ${plural(result.courses, "class")} and ${plural(result.assignments, "assignment")}.`;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// "Just now", "5 minutes ago", "3 hours ago", then a date once it's more than a day old.
export function formatLastSynced(lastSyncedAt: string | null, now: Date = new Date()): string {
  if (!lastSyncedAt) {
    return "Never synced";
  }
  const then = new Date(lastSyncedAt);
  const elapsed = now.getTime() - then.getTime();
  if (Number.isNaN(elapsed)) {
    return "Never synced";
  }
  if (elapsed < MINUTE) {
    return "Just now";
  }
  if (elapsed < HOUR) {
    return `${plural(Math.floor(elapsed / MINUTE), "minute")} ago`;
  }
  if (elapsed < 24 * HOUR) {
    return `${plural(Math.floor(elapsed / HOUR), "hour")} ago`;
  }
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    then,
  );
}
