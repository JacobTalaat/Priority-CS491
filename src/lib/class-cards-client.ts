import { apiRequest } from "./api-client";
import { getToken } from "./session";
import type { GradeCategorySummary } from "./course-grade-summary";
import type { WeightedGradeResult } from "./weighted-grade";

export type ClassCard = {
  id: string;
  name: string;
  courseCode: string | null;
  term: string | null;
  confirmed: boolean;
  grade:
    | WeightedGradeResult
    | { status: "unsupported"; reason: "invalid-setup" | "no-confirmed-setup" };
  categoryBreakdown: GradeCategorySummary[];
  nextDue: { title: string; dueAt: string } | null;
};

export type ClassCardsResponse = {
  connected: boolean;
  courses: ClassCard[];
};

export function getClassCards() {
  return apiRequest<ClassCardsResponse>("/api/courses/class-cards", { token: getToken() });
}
