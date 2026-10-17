import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSessionFindUnique, mockCourseFindFirst } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockCourseFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    course: { findFirst: mockCourseFindFirst },
  },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ courseId: "course-1" }) };

function request(withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer test-token");
  }
  return new Request("http://localhost/api/courses/course-1/grade", { headers });
}

const setup = {
  categories: [
    { name: "Homework", weight: 40 },
    { name: "Exams", weight: 40 },
  ],
  assignmentMappings: [
    { assignmentId: "assignment-1", category: "Homework" },
    { assignmentId: "assignment-2", category: "Exams" },
  ],
  finalExamWeight: 20,
  cutoffs: { A: 90 },
  classDetails: {},
};

describe("GET /api/courses/[courseId]/grade", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue({
      id: "session-1",
      expiresAt: new Date(Date.now() + 60 * 1000),
      user: { id: "user-1", email: "student@example.com" },
    });
    mockCourseFindFirst.mockReset().mockResolvedValue({
      id: "course-1",
      gradeSetup: setup,
      assignments: [
        { id: "assignment-1", pointsPossible: 20, grade: { score: 18 } },
        { id: "assignment-2", pointsPossible: 100, grade: { score: 80 } },
      ],
    });
  });

  it("returns the current weighted grade and category breakdown for the student's current course", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      courseId: "course-1",
      supported: true,
      currentGrade: 85,
      categories: [
        { name: "Homework", weight: 40, grade: 90 },
        { name: "Exams", weight: 40, grade: 80 },
      ],
      message: null,
    });
    expect(mockCourseFindFirst).toHaveBeenCalledWith({
      where: { id: "course-1", userId: "user-1", isCurrent: true },
      select: {
        id: true,
        gradeSetup: {
          select: {
            categories: true,
            assignmentMappings: true,
            finalExamWeight: true,
            cutoffs: true,
            classDetails: true,
          },
        },
        assignments: {
          select: { id: true, pointsPossible: true, grade: { select: { score: true } } },
        },
      },
    });
  });

  it("returns Unsupported data when the course has no confirmed setup", async () => {
    mockCourseFindFirst.mockResolvedValue({ id: "course-1", gradeSetup: null, assignments: [] });
    const response = await GET(request(), context);
    await expect(response.json()).resolves.toMatchObject({
      supported: false,
      currentGrade: null,
      message: "Confirm a valid grade setup to calculate this grade.",
    });
  });

  it("does not expose another student's or a non-current course", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Current course not found." });
  });

  it("requires an app session", async () => {
    const response = await GET(request(false), context);
    expect(response.status).toBe(401);
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });
});
