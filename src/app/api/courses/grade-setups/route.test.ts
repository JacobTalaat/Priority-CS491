import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSessionFindUnique, mockCourseFindMany } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockCourseFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    course: { findMany: mockCourseFindMany },
  },
}));

import { GET } from "./route";

function request(withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer session-token");
  }
  return new Request("http://localhost/api/courses/grade-setups", { headers });
}

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

describe("GET /api/courses/grade-setups", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockCourseFindMany.mockReset().mockResolvedValue([]);
  });

  it("returns the authenticated student's current courses, weights, assignments, and saved setups", async () => {
    const courses = [
      {
        id: "course-1",
        name: "Algorithms",
        courseCode: "CS-341",
        term: "Fall 2026",
        assignmentGroups: [{ name: "Homework", groupWeight: 30 }],
        assignments: [
          { id: "assignment-1", title: "Project 1", assignmentGroup: { name: "Homework", groupWeight: 30 } },
        ],
        gradeSetup: null,
      },
    ];
    mockCourseFindMany.mockResolvedValue(courses);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ courses });
    expect(mockCourseFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", isCurrent: true },
      select: {
        id: true,
        name: true,
        courseCode: true,
        term: true,
        assignmentGroups: {
          select: { name: true, groupWeight: true },
          orderBy: [{ position: "asc" }, { name: "asc" }],
        },
        assignments: {
          select: {
            id: true,
            title: true,
            assignmentGroup: { select: { name: true, groupWeight: true } },
          },
          orderBy: [{ title: "asc" }, { id: "asc" }],
        },
        gradeSetup: {
          select: {
            categories: true,
            assignmentMappings: true,
            finalExamWeight: true,
            cutoffs: true,
            classDetails: true,
            unsupportedRules: true,
            confirmedAt: true,
          },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  });

  it("requires an app session", async () => {
    const response = await GET(request(false));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockCourseFindMany).not.toHaveBeenCalled();
  });
});
