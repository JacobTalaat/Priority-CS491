import { apiRequest } from "./api-client";
import { getToken } from "./session";
import type { FinalExamResult } from "./final-exam-solver";
import type { CategoryBreakdown } from "./grade-engine";
import type { AssignmentShare } from "./grade-share";
import type { WeightedGradeResult } from "./weighted-grade";

// GET /api/courses/[courseId]
export type CourseDetailsResponse = {
  course: {
    id: string;
    name: string;
    courseCode: string | null;
    term: string | null;
    termEndsAt: string | null;
  };
  details: {
    instructor: string | null;
    section: string | null;
    credits: number | null;
    officeHours: string | null;
    latePolicy: string | null;
    contacts: string | null;
    confirmedAt: string | null;
  };
  assignments: {
    id: string;
    title: string;
    dueAt: string | null;
    hasDueDate: boolean;
    pointsPossible: number;
    htmlUrl: string | null;
    assignmentGroup: { name: string } | null;
    grade: { score: number | null; gradedAt: string | null } | null;
  }[];
};

// GET /api/courses/[courseId]/grade
export type CourseGradeResponse = {
  setupConfirmed: boolean;
  engine: "weighted" | "points";
  grade: WeightedGradeResult;
  breakdown: CategoryBreakdown[];
  finalExam: FinalExamResult;
  shares: AssignmentShare[];
};

export function getCourseDetails(courseId: string) {
  return apiRequest<CourseDetailsResponse>(`/api/courses/${encodeURIComponent(courseId)}`, {
    token: getToken(),
  });
}

export function getCourseGrade(courseId: string) {
  return apiRequest<CourseGradeResponse>(`/api/courses/${encodeURIComponent(courseId)}/grade`, {
    token: getToken(),
  });
}

export function saveManualGrade(courseId: string, assignmentId: string, score: number) {
  return apiRequest<{ grade: { score: number; gradedAt: string; isManual: true } }>(
    `/api/courses/${encodeURIComponent(courseId)}/grades`,
    {
      method: "POST",
      token: getToken(),
      body: { assignmentId, score },
    },
  );
}
