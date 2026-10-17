import { apiRequest } from "./api-client";
import { getToken } from "./session";
import type { GradeSetupPayload } from "./grade-setup";

export type GradeSetupCourse = {
  id: string;
  name: string;
  courseCode: string | null;
  term: string | null;
  assignmentGroups: { name: string; groupWeight: number | null }[];
  assignments: {
    id: string;
    title: string;
    dueAt: string | null;
    assignmentGroup: { name: string; groupWeight: number | null } | null;
  }[];
  gradeSetup: (GradeSetupPayload & { confirmedAt: string }) | null;
};

export type CourseGrade = {
  courseId: string;
  supported: boolean;
  currentGrade: number | null;
  categories: { name: string; weight: number; grade: number | null }[];
  message: string | null;
};

export function getGradeSetupCourses() {
  return apiRequest<{ courses: GradeSetupCourse[] }>("/api/courses/grade-setups", { token: getToken() });
}

export function getCourseGrade(courseId: string) {
  return apiRequest<CourseGrade>(`/api/courses/${encodeURIComponent(courseId)}/grade`, { token: getToken() });
}

export function saveGradeSetup(courseId: string, setup: GradeSetupPayload) {
  return apiRequest<{ confirmed: true; courseId: string; confirmedAt: string }>(
    `/api/courses/${encodeURIComponent(courseId)}/grade-setup`,
    { method: "POST", token: getToken(), body: setup },
  );
}
