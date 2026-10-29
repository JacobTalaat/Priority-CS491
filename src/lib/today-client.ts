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
