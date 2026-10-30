import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSessionFindUnique, mockCourseFindFirst, mockAnswerQuestion } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockAnswerQuestion: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    course: { findFirst: mockCourseFindFirst },
  },
}));

vi.mock("@/lib/ask-classes", () => ({
  answerQuestion: mockAnswerQuestion,
}));

import { POST } from "./route";

function request(body: unknown, withSession = true) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (withSession) {
    headers.set("Authorization", "Bearer session-token");
  }
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

const ANSWER = {
  ok: true as const,
  found: true as const,
  answer: "Friday, Oct 23.",
  sources: [
    {
      kind: "assignment" as const,
      courseId: "course-2",
      courseName: "Data Structures",
      source: { assignmentId: "assignment-1", title: "Homework 3", htmlUrl: null },
      quote: "Homework 3 — CS 114 — due Fri Oct 23, 2026",
    },
  ],
};

describe("POST /api/ask", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockCourseFindFirst.mockReset().mockResolvedValue({ id: "course-2" });
    mockAnswerQuestion.mockReset().mockResolvedValue(ANSWER);
  });

  it("answers with server-built sources for the authenticated student", async () => {
    const response = await POST(request({ question: "when is homework 3 due" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ found: true, answer: "Friday, Oct 23.", sources: ANSWER.sources });
    expect(mockAnswerQuestion).toHaveBeenCalledWith({
      userId: "user-1",
      question: "when is homework 3 due",
    });
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });

  it("passes the course check before asking when a courseId is given", async () => {
    const response = await POST(request({ question: "why", courseId: "course-2" }));
    expect(response.status).toBe(200);
    expect(mockCourseFindFirst).toHaveBeenCalledWith({
      where: { id: "course-2", userId: "user-1", isCurrent: true },
      select: { id: true },
    });
    expect(mockAnswerQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", question: "why", courseId: "course-2" })
    );
  });

  it("returns 404 when the course is not one of the student's current courses", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const response = await POST(request({ question: "why", courseId: "course-9" }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Current course not found." });
    expect(mockAnswerQuestion).not.toHaveBeenCalled();
  });

  it("accepts a trimmed question and rejects an out-of-bounds one", async () => {
    mockAnswerQuestion.mockResolvedValue({ ok: false, reason: "invalid-question" });
    const response = await POST(request({ question: "   " }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid body" });
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });

  it("returns the not-found message when the question spans a whole course", async () => {
    mockAnswerQuestion.mockResolvedValue({ ok: true, found: false });
    const response = await POST(request({ question: "what is the meaning of life" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      found: false,
      message: "Priority couldn't find that in your syllabus or Canvas data.",
    });
  });

  it("maps the AI cap to 503 and other failures to 502", async () => {
    mockAnswerQuestion.mockResolvedValue({ ok: false, reason: "cap-reached" });
    const capped = await POST(request({ question: "why" }));
    expect(capped.status).toBe(503);
    await expect(capped.json()).resolves.toEqual({
      error: "Priority's AI budget for this month is used up, so it couldn't answer. Try again later.",
    });

    mockAnswerQuestion.mockResolvedValue({ ok: false, reason: "failed" });
    const failed = await POST(request({ question: "why" }));
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({
      error: "Priority couldn't answer that right now. Try again.",
    });
  });

  it("rejects invalid bodies and question shapes", async () => {
    const raw = new Request("http://localhost/api/ask", {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer session-token" }),
      body: "not json",
    });
    const malformed = await POST(raw);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: "Invalid body" });

    for (const body of [
      null,
      "why",
      123,
      {},
      { question: 7 },
      { question: "why", courseId: 9 },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Invalid body" });
    }
    expect(mockAnswerQuestion).not.toHaveBeenCalled();
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });

  it("requires an app session", async () => {
    const response = await POST(request({ question: "why" }, false));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockAnswerQuestion).not.toHaveBeenCalled();
  });

  it("forces dynamic rendering", async () => {
    const { dynamic } = await import("./route");
    expect(dynamic).toBe("force-dynamic");
  });
});
