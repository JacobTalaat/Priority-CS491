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
    headers.set("Authorization", "Bearer test-session");
  }
  return new Request("http://localhost/api/today", { headers });
}

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

describe("GET /api/today", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockCourseFindMany.mockReset().mockResolvedValue([]);
  });

  it("returns ungraded assignments in due-date order from the student's current courses", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        courseCode: "CS-341",
        assignments: [
          {
            id: "later",
            title: "Later homework",
            dueAt: new Date("2026-11-01T12:00:00Z"),
            hasDueDate: true,
            pointsPossible: 20,
            grade: null,
          },
          {
            id: "graded",
            title: "Graded homework",
            dueAt: new Date("2026-10-25T12:00:00Z"),
            hasDueDate: true,
            pointsPossible: 10,
            grade: { score: 8 },
          },
        ],
      },
      {
        id: "course-2",
        name: "Databases",
        courseCode: "CS-331",
        assignments: [
          {
            id: "sooner",
            title: "Sooner project",
            dueAt: new Date("2026-10-26T12:00:00Z"),
            hasDueDate: true,
            pointsPossible: 50,
            grade: { score: null },
          },
          {
            id: "no-date",
            title: "Practice",
            dueAt: null,
            hasDueDate: false,
            pointsPossible: 0,
            grade: null,
          },
        ],
      },
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assignments: [
        {
          id: "sooner",
          title: "Sooner project",
          dueAt: "2026-10-26T12:00:00.000Z",
          hasDueDate: true,
          pointsPossible: 50,
          course: { id: "course-2", name: "Databases", courseCode: "CS-331" },
        },
        {
          id: "later",
          title: "Later homework",
          dueAt: "2026-11-01T12:00:00.000Z",
          hasDueDate: true,
          pointsPossible: 20,
          course: { id: "course-1", name: "Algorithms", courseCode: "CS-341" },
        },
        {
          id: "no-date",
          title: "Practice",
          dueAt: null,
          hasDueDate: false,
          pointsPossible: 0,
          course: { id: "course-2", name: "Databases", courseCode: "CS-331" },
        },
      ],
    });
    expect(mockCourseFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", isCurrent: true },
      select: {
        id: true,
        name: true,
        courseCode: true,
        assignments: {
          select: {
            id: true,
            title: true,
            dueAt: true,
            hasDueDate: true,
            pointsPossible: true,
            grade: { select: { score: true } },
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
