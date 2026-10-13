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
    assignmentGroup: { name: string; groupWeight: number | null } | null;
  }[];
  gradeSetup: (GradeSetupPayload & { confirmedAt: string }) | null;
};

export function getGradeSetupCourses() {
  return apiRequest<{ courses: GradeSetupCourse[] }>("/api/courses/grade-setups", { token: getToken() });
}

export function saveGradeSetup(courseId: string, setup: GradeSetupPayload) {
  return apiRequest<{ confirmed: true; courseId: string; confirmedAt: string }>(
    `/api/courses/${encodeURIComponent(courseId)}/grade-setup`,
    { method: "POST", token: getToken(), body: setup },
  );
}
