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
  classDetails: { instructor: "Professor Example", section: "02", finalExamAssignmentId: "assignment-1" },
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

  it("rejects a final exam weight without a picked final", async () => {
    const response = await POST(
      request({ ...SETUP, classDetails: { instructor: "Professor Example", section: "02" } }),
      context,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Pick which assignment is the final exam, or set the final exam weight to 0.",
    });
    expect(mockGradeSetupUpsert).not.toHaveBeenCalled();
  });

  it("rejects a final exam weight with a final that is not an assignment of this course", async () => {
    mockAssignmentFindMany.mockResolvedValue([{ id: "assignment-1" }, { id: "assignment-2" }]);
    const response = await POST(
      request({
        ...SETUP,
        assignmentMappings: [
          { assignmentId: "assignment-1", category: "Homework" },
          { assignmentId: "assignment-2", category: "Homework" },
        ],
        classDetails: { ...SETUP.classDetails, finalExamAssignmentId: "assignment-3" },
      }),
      context,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Pick which assignment is the final exam, or set the final exam weight to 0.",
    });
    expect(mockGradeSetupUpsert).not.toHaveBeenCalled();
  });

  it("saves a weight of 0 with no final picked", async () => {
    const response = await POST(
      request({
        ...SETUP,
        finalExamWeight: 0,
        categories: [
          { name: "Homework", weight: 70 },
          { name: "Exams", weight: 30 },
        ],
        classDetails: { instructor: "Professor Example", section: "02" },
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mockGradeSetupUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ finalExamWeight: 0 }),
      }),
    );
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
