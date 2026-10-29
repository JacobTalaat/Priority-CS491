import { apiRequest } from "./api-client";
import type { LetterBoundary } from "./letter-boundary";
import { getToken } from "./session";

// One row of GET /api/today, in ranked order.
export type TodayItem = {
  rank: number;
  assignmentId: string;
  courseId: string;
  courseName: string;
  title: string;
  dueAt: string | null;
  dueDay: string | null;
  overdue: boolean;
  share: number | null;
  hours: number | null;
  estimated: boolean;
  score: number | null;
  reason: string;
  boundary: LetterBoundary | null;
};

export type TodayResponse = {
  generatedAt: string;
  items: TodayItem[];
  hoursFilter: { hours: number; plannedHours: number; unestimatedCount: number; skippedCount: number } | null;
};

export function getToday() {
  return apiRequest<TodayResponse>("/api/today", { token: getToken() });
}

// What the student was looking at when they tapped, for the study's event log.
export type ShownItem = { rank: number; listGeneratedAt: string };

// The website identifies itself so the event log can tell web taps from app taps, and every
// action carries its own request id so a retried request is never logged twice.
function actionHeaders(requestId: string): Record<string, string> {
  return { "X-Priority-Client": "web", "X-Priority-Request-Id": requestId };
}

export function markDone(assignmentId: string, shown: ShownItem, requestId: string) {
  return apiRequest<{ assignmentId: string; status: string }>(
    `/api/today/items/${encodeURIComponent(assignmentId)}/done`,
    { method: "POST", token: getToken(), body: shown, headers: actionHeaders(requestId) },
  );
}

export function undoItem(assignmentId: string, requestId: string) {
  return apiRequest<{ assignmentId: string; undone: boolean }>(
    `/api/today/items/${encodeURIComponent(assignmentId)}`,
    { method: "DELETE", token: getToken(), headers: actionHeaders(requestId) },
  );
}
