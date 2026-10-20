import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSessionFindUnique, mockGetCanvasStatus, mockCourseFindMany } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockGetCanvasStatus: vi.fn(),
  mockCourseFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    course: { findMany: mockCourseFindMany },
  },
}));

vi.mock("@/lib/canvas-credentials", () => ({
  getCanvasStatus: mockGetCanvasStatus,
}));

import { GET } from "./route";

function request(withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer test-token");
  }
  return new Request("http://localhost/api/courses/class-cards", { headers });
}

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

const confirmedSetup = {
  categories: [
    { name: "Homework", weight: 60 },
    { name: "Exams", weight: 40 },
  ],
  assignmentMappings: [
    { assignmentId: "homework-1", category: "Homework" },
    { assignmentId: "exam-1", category: "Exams" },
  ],
  finalExamWeight: 0,
  cutoffs: { A: 90, B: 80 },
  classDetails: {},
  confirmedAt: new Date("2026-10-01T12:00:00.000Z"),
};

describe("GET /api/courses/class-cards", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockGetCanvasStatus.mockReset().mockResolvedValue({ connected: true });
    mockCourseFindMany.mockReset().mockResolvedValue([]);
  });

  it("returns each current class with grade, category breakdown, next due item, and setup state", async () => {
    const dueAt = new Date("2099-10-20T12:00:00.000Z");
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        courseCode: "CS-341",
        term: "Fall 2026",
        assignments: [
          {
            id: "homework-overdue",
            title: "Homework due last week",
            dueAt: new Date("2020-10-19T12:00:00.000Z"),
            pointsPossible: 10,
            grade: { score: null },
          },
          { id: "homework-1", title: "Homework 1", dueAt, pointsPossible: 100, grade: { score: 80 } },
          {
            id: "exam-1",
            title: "Midterm",
            dueAt: new Date("2099-11-01T12:00:00.000Z"),
            pointsPossible: 50,
            grade: { score: 45 },
          },
        ],
        gradeSetup: confirmedSetup,
      },
      {
        id: "course-2",
        name: "Statistics",
        courseCode: null,
        term: null,
        assignments: [],
        gradeSetup: null,
      },
    ]);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      connected: true,
      courses: [
        {
          id: "course-1",
          name: "Algorithms",
          courseCode: "CS-341",
          term: "Fall 2026",
          confirmed: true,
          grade: { status: "calculated", percentage: 84 },
          categoryBreakdown: [
            { name: "Homework", weight: 60, percentage: 80 },
            { name: "Exams", weight: 40, percentage: 90 },
          ],
          nextDue: { title: "Homework 1", dueAt: dueAt.toISOString() },
        },
        {
          id: "course-2",
          name: "Statistics",
          courseCode: null,
          term: null,
          confirmed: false,
          grade: { status: "unsupported", reason: "no-confirmed-setup" },
          categoryBreakdown: [],
          nextDue: null,
        },
      ],
    });
    expect(mockCourseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", isCurrent: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("returns no cards if Canvas is not connected", async () => {
    mockGetCanvasStatus.mockResolvedValue({ connected: false });
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connected: false, courses: [] });
    expect(mockCourseFindMany).not.toHaveBeenCalled();
  });

  it("requires an app session", async () => {
    const response = await GET(request(false));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockGetCanvasStatus).not.toHaveBeenCalled();
    expect(mockCourseFindMany).not.toHaveBeenCalled();
  });
});
