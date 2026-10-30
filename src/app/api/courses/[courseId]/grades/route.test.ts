import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSessionFindUnique,
  mockCourseFindFirst,
  mockAssignmentFindFirst,
  mockGradeFindUnique,
  mockGradeUpsert,
  mockGradeUpdate,
  mockGradeDelete,
} = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockAssignmentFindFirst: vi.fn(),
  mockGradeFindUnique: vi.fn(),
  mockGradeUpsert: vi.fn(),
  mockGradeUpdate: vi.fn(),
  mockGradeDelete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    course: { findFirst: mockCourseFindFirst },
    assignment: { findFirst: mockAssignmentFindFirst },
    grade: {
      findUnique: mockGradeFindUnique,
      upsert: mockGradeUpsert,
      update: mockGradeUpdate,
      delete: mockGradeDelete,
    },
  },
}));

import { DELETE, PATCH, POST } from "./route";

const GRADED_AT = new Date("2026-10-21T18:30:00.000Z");

function gradeRow(score: number) {
  return {
    id: "grade-1",
    assignmentId: "assignment-1",
    score,
    gradedAt: GRADED_AT,
    isManual: true,
    createdAt: GRADED_AT,
    updatedAt: GRADED_AT,
  };
}

function jsonRequest(method: "POST" | "PATCH", body: unknown, withSession = true) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (withSession) {
    headers.set("Authorization", "Bearer session-token");
  }
  return new Request("http://localhost/api/courses/course-1/grades", {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

function deleteRequest(options: { assignmentId?: string; inBody?: boolean; withSession?: boolean } = {}) {
  const url = options.assignmentId && options.inBody !== true
    ? `http://localhost/api/courses/course-1/grades?assignmentId=${options.assignmentId}`
    : "http://localhost/api/courses/course-1/grades";
  const headers = new Headers();
  if (options.withSession !== false) {
    headers.set("Authorization", "Bearer session-token");
  }
  if (options.inBody) {
    headers.set("Content-Type", "application/json");
    return new Request(url, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ assignmentId: options.assignmentId }),
    });
  }
  return new Request(url, { method: "DELETE", headers });
}

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

const context = { params: Promise.resolve({ courseId: "course-1" }) };
const ASSIGNMENT = { assignmentId: "assignment-1" };

async function runAll(body: unknown): Promise<Response[]> {
  return Promise.all([
    POST(jsonRequest("POST", body), context),
    PATCH(jsonRequest("PATCH", body), context),
    DELETE(deleteRequest({ assignmentId: ASSIGNMENT.assignmentId }), context),
  ]);
}

describe("manual grades route", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockCourseFindFirst.mockReset().mockResolvedValue({ id: "course-1" });
    mockAssignmentFindFirst.mockReset().mockResolvedValue({ id: "assignment-1", pointsPossible: 20 });
    mockGradeFindUnique.mockReset().mockResolvedValue(gradeRow(15));
    mockGradeUpsert.mockReset().mockResolvedValue(gradeRow(18));
    mockGradeUpdate.mockReset().mockResolvedValue(gradeRow(17));
    mockGradeDelete.mockReset().mockResolvedValue(gradeRow(15));
  });

  it("saves a manual grade for the student's current course and returns it", async () => {
    const response = await POST(jsonRequest("POST", { ...ASSIGNMENT, score: 18 }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockCourseFindFirst).toHaveBeenCalledWith({
      where: { id: "course-1", userId: "user-1", isCurrent: true },
      select: { id: true },
    });
    expect(mockAssignmentFindFirst).toHaveBeenCalledWith({
      where: { id: "assignment-1", courseId: "course-1" },
      select: { id: true, pointsPossible: true },
    });
    expect(mockGradeUpsert).toHaveBeenCalledWith({
      where: { assignmentId: "assignment-1" },
      create: { assignmentId: "assignment-1", score: 18, gradedAt: expect.any(Date), isManual: true },
      update: { score: 18, gradedAt: expect.any(Date), isManual: true },
    });
    expect(body.grade).toEqual({
      ...gradeRow(18),
      gradedAt: GRADED_AT.toISOString(),
      createdAt: GRADED_AT.toISOString(),
      updatedAt: GRADED_AT.toISOString(),
    });
  });

  it("changes the score of an existing manual grade and returns it", async () => {
    const response = await PATCH(jsonRequest("PATCH", { ...ASSIGNMENT, score: 17 }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGradeFindUnique).toHaveBeenCalledWith({ where: { assignmentId: "assignment-1" } });
    expect(mockGradeUpdate).toHaveBeenCalledWith({
      where: { assignmentId: "assignment-1" },
      data: { score: 17, gradedAt: expect.any(Date) },
    });
    expect(body.grade).toEqual({
      ...gradeRow(17),
      gradedAt: GRADED_AT.toISOString(),
      createdAt: GRADED_AT.toISOString(),
      updatedAt: GRADED_AT.toISOString(),
    });
  });

  it("deletes a manual grade named in the query string", async () => {
    const response = await DELETE(deleteRequest({ assignmentId: "assignment-1" }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGradeDelete).toHaveBeenCalledWith({ where: { assignmentId: "assignment-1" } });
    expect(body).toEqual({ deleted: true });
  });

  it("deletes a manual grade named in a JSON body when the query string is empty", async () => {
    const response = await DELETE(deleteRequest({ assignmentId: "assignment-1", inBody: true }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGradeDelete).toHaveBeenCalledWith({ where: { assignmentId: "assignment-1" } });
    expect(body).toEqual({ deleted: true });
  });

  it("saves a score above points possible as extra credit, like the engine does", async () => {
    const response = await POST(jsonRequest("POST", { ...ASSIGNMENT, score: 25 }), context);
    expect(response.status).toBe(200);
    expect(mockGradeUpsert.mock.calls[0][0].create.score).toBe(25);
  });

  it("changes a score above points possible when editing, like the engine does", async () => {
    const response = await PATCH(jsonRequest("PATCH", { ...ASSIGNMENT, score: 25 }), context);
    expect(response.status).toBe(200);
    expect(mockGradeUpdate.mock.calls[0][0].data.score).toBe(25);
  });

  it("saves a positive score on a zero-point assignment as bonus, like the engine does", async () => {
    mockAssignmentFindFirst.mockResolvedValue({ id: "assignment-1", pointsPossible: 0 });
    const response = await POST(jsonRequest("POST", { ...ASSIGNMENT, score: 5 }), context);
    expect(response.status).toBe(200);
    expect(mockGradeUpsert.mock.calls[0][0].create.score).toBe(5);
  });

  it("rejects invalid JSON without touching a grade", async () => {
    const request = new Request("http://localhost/api/courses/course-1/grades", {
      method: "POST",
      headers: { Authorization: "Bearer session-token", "Content-Type": "application/json" },
      body: "{not json",
    });
    const response = await POST(request, context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON body." });
    expect(mockGradeUpsert).not.toHaveBeenCalled();
  });

  it("rejects a missing, textual, or negative score in plain language", async () => {
    const cases: [unknown, string][] = [
      [{ assignmentId: "assignment-1" }, "Enter a score as a number."],
      [{ assignmentId: "assignment-1", score: "18" }, "Enter a score as a number."],
      [{ assignmentId: "assignment-1", score: -1 }, "A score can't be below zero."],
    ];
    for (const [body, expectedError] of cases) {
      const response = await POST(jsonRequest("POST", body), context);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: expectedError });
    }
    expect(mockGradeUpsert).not.toHaveBeenCalled();
  });

  it("never writes a grade onto another student's or a non-current course", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const responses = await runAll({ ...ASSIGNMENT, score: 18 });
    for (const response of responses) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Current course not found." });
    }
    expect(mockAssignmentFindFirst).not.toHaveBeenCalled();
    expect(mockGradeUpsert).not.toHaveBeenCalled();
    expect(mockGradeUpdate).not.toHaveBeenCalled();
    expect(mockGradeDelete).not.toHaveBeenCalled();
  });

  it("rejects an assignment that does not belong to the course, proving a guessed id writes nothing", async () => {
    mockAssignmentFindFirst.mockResolvedValue(null);
    const responses = await runAll({ ...ASSIGNMENT, score: 18 });
    for (const response of responses) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "Assignment not found in this course.",
      });
    }
    expect(mockGradeUpsert).not.toHaveBeenCalled();
    expect(mockGradeUpdate).not.toHaveBeenCalled();
    expect(mockGradeDelete).not.toHaveBeenCalled();
  });

  it("refuses to edit or delete a grade that came from Canvas", async () => {
    mockGradeFindUnique.mockResolvedValue({ ...gradeRow(15), isManual: false });
    const patch = await PATCH(jsonRequest("PATCH", { ...ASSIGNMENT, score: 17 }), context);
    const del = await DELETE(deleteRequest({ assignmentId: "assignment-1" }), context);
    for (const response of [patch, del]) {
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "This grade comes from Canvas, so it can't be edited or deleted here.",
      });
    }
    expect(mockGradeUpdate).not.toHaveBeenCalled();
    expect(mockGradeDelete).not.toHaveBeenCalled();
  });

  it("reports a missing grade when editing or deleting an assignment without one", async () => {
    mockGradeFindUnique.mockResolvedValue(null);
    const patch = await PATCH(jsonRequest("PATCH", { ...ASSIGNMENT, score: 17 }), context);
    const del = await DELETE(deleteRequest({ assignmentId: "assignment-1" }), context);
    for (const response of [patch, del]) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "No grade is saved for this assignment.",
      });
    }
    expect(mockGradeUpdate).not.toHaveBeenCalled();
    expect(mockGradeDelete).not.toHaveBeenCalled();
  });

  it("asks which assignment to delete when none is named", async () => {
    const response = await DELETE(deleteRequest(), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose the assignment whose grade you want to delete.",
    });
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
    expect(mockGradeDelete).not.toHaveBeenCalled();
  });

  it("requires an app session", async () => {
    const responses = await Promise.all([
      POST(jsonRequest("POST", { ...ASSIGNMENT, score: 18 }, false), context),
      PATCH(jsonRequest("PATCH", { ...ASSIGNMENT, score: 18 }, false), context),
      DELETE(deleteRequest({ assignmentId: "assignment-1", withSession: false }), context),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    }
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
    expect(mockGradeUpsert).not.toHaveBeenCalled();
    expect(mockGradeUpdate).not.toHaveBeenCalled();
    expect(mockGradeDelete).not.toHaveBeenCalled();
  });

  it("forces dynamic rendering", async () => {
    const { dynamic } = await import("./route");
    expect(dynamic).toBe("force-dynamic");
  });
});
