import { apiRequest } from "./api-client";
import { getToken } from "./session";

export type AskSource = {
  kind: "syllabus" | "assignment" | "class-details";
  courseId: string;
  courseName: string;
  source: Record<string, unknown>;
  quote: string;
};

export type AskResponse =
  | { found: true; answer: string; sources: AskSource[] }
  | { found: false; message: string };

export function askClasses(question: string) {
  return apiRequest<AskResponse>("/api/ask", {
    method: "POST",
    token: getToken(),
    body: { question },
  });
}
