import { apiRequest } from "./api-client";
import { getToken } from "./session";

export type TodayAssignment = {
  id: string;
  title: string;
  dueAt: string | null;
  hasDueDate: boolean;
  pointsPossible: number;
  course: { id: string; name: string; courseCode: string | null };
};

export function getTodayAssignments() {
  return apiRequest<{ assignments: TodayAssignment[] }>("/api/today", { token: getToken() });
}
