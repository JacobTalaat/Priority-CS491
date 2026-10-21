import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSessionFindUnique,
  mockCourseFindFirst,
  mockAssignmentFindMany,
  mockGradeSetupUpsert,
} = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockAssignmentFindMany: vi.fn(),
  mockGradeSetupUpsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    course: { findFirst: mockCourseFindFirst },
    assignment: { findMany: mockAssignmentFindMany },
    courseGradeSetup: { upsert: mockGradeSetupUpsert },
  },
}));

import { POST } from "./route";

const SETUP = {
  categories: [
    { name: "Homework", weight: 30 },
    { name: "Exams", weight: 50 },
  ],
  assignmentMappings: [{ assignmentId: "assignment-1", category: "Homework" }],
  finalExamWeight: 20,
  cutoffs: { A: 90, B: 80 },
  classDetails: { instructor: "Professor Example", section: "02" },
};

function request(body: unknown = SETUP, withSession = true) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (withSession) {
    headers.set("Authorization", "Bearer session-token");
  }
  return new Request("http://localhost/api/courses/course-1/grade-setup", {
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

const context = { params: Promise.resolve({ courseId: "course-1" }) };

describe("POST /api/courses/[courseId]/grade-setup", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockCourseFindFirst.mockReset().mockResolvedValue({ id: "course-1" });
    mockAssignmentFindMany.mockReset().mockResolvedValue([{ id: "assignment-1" }]);
    mockGradeSetupUpsert.mockReset().mockResolvedValue({});
  });

  it("saves all setup details for the authenticated student's current course", async () => {
    const response = await POST(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ confirmed: true, courseId: "course-1" });
    expect(body.confirmedAt).toEqual(expect.any(String));
    expect(mockCourseFindFirst).toHaveBeenCalledWith({
      where: { id: "course-1", userId: "user-1", isCurrent: true },
      select: { id: true },
    });
    expect(mockAssignmentFindMany).toHaveBeenCalledWith({
      where: { courseId: "course-1" },
      select: { id: true },
    });
    expect(mockGradeSetupUpsert).toHaveBeenCalledWith({
      where: { courseId: "course-1" },
      create: expect.objectContaining({
        courseId: "course-1",
        categories: SETUP.categories,
        assignmentMappings: SETUP.assignmentMappings,
        finalExamWeight: 20,
        cutoffs: SETUP.cutoffs,
        classDetails: SETUP.classDetails,
        confirmedAt: expect.any(Date),
      }),
      update: expect.objectContaining({
        categories: SETUP.categories,
        assignmentMappings: SETUP.assignmentMappings,
        finalExamWeight: 20,
        cutoffs: SETUP.cutoffs,
        classDetails: SETUP.classDetails,
        confirmedAt: expect.any(Date),
      }),
    });
  });

  it("keeps saved rules when the body omits the unsupportedRules field", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    const [upsertArgs] = mockGradeSetupUpsert.mock.calls;
    expect(upsertArgs[0].update).not.toHaveProperty("unsupportedRules");
    expect(upsertArgs[0].update.confirmedAt).toEqual(expect.any(Date));
  });

  it("clears saved rules only on an explicit empty list", async () => {
    const response = await POST(request({ ...SETUP, unsupportedRules: [] }), context);
    expect(response.status).toBe(200);
    const [upsertArgs] = mockGradeSetupUpsert.mock.calls;
    expect(upsertArgs[0].update.unsupportedRules).toEqual([]);
    expect(upsertArgs[0].create.unsupportedRules).toEqual([]);
  });

  it("saves rules the body provides explicitly", async () => {
    const response = await POST(request({ ...SETUP, unsupportedRules: ["drop the lowest quiz"] }), context);
    expect(response.status).toBe(200);
    const [upsertArgs] = mockGradeSetupUpsert.mock.calls;
    expect(upsertArgs[0].update.unsupportedRules).toEqual(["drop the lowest quiz"]);
  });

  it("rejects a malformed unsupportedRules value with 400 instead of saving", async () => {
    const malformed = ["drop the lowest quiz", [{ id: "nope" }], 7, true];
    for (const unsupportedRules of malformed) {
      mockGradeSetupUpsert.mockClear();
      const response = await POST(request({ ...SETUP, unsupportedRules }), context);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Unsupported rules must be a list of at most 20 short text rules.",
      });
      expect(mockGradeSetupUpsert).not.toHaveBeenCalled();
    }
  });

  it("rejects invalid JSON and invalid weights without saving", async () => {
    const invalidWeights = await POST(request({ ...SETUP, finalExamWeight: 19 }), context);
    expect(invalidWeights.status).toBe(400);
    await expect(invalidWeights.json()).resolves.toEqual({
      error: "Category weights and the final exam weight must add up to 100.",
    });
    expect(mockGradeSetupUpsert).not.toHaveBeenCalled();
  });

  it("rejects setups that omit one or more course assignments", async () => {
    mockAssignmentFindMany.mockResolvedValue([{ id: "assignment-1" }, { id: "assignment-2" }]);
    const response = await POST(request(), context);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Map every assignment in this course before confirming the setup.",
    });
    expect(mockGradeSetupUpsert).not.toHaveBeenCalled();
  });

  it("rejects mappings to assignments outside the course", async () => {
    const response = await POST(
      request({
        ...SETUP,
        assignmentMappings: [{ assignmentId: "another-course-assignment", category: "Homework" }],
      }),
      context,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "An assignment mapping does not belong to this course.",
    });
    expect(mockGradeSetupUpsert).not.toHaveBeenCalled();
  });

  it("does not save a setup for another user's or a non-current course", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const response = await POST(request(), context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Current course not found." });
    expect(mockAssignmentFindMany).not.toHaveBeenCalled();
    expect(mockGradeSetupUpsert).not.toHaveBeenCalled();
  });

  it("requires an app session", async () => {
    const response = await POST(request(SETUP, false), context);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });
});
