import { beforeEach, describe, expect, it, vi } from "vitest";
<<<<<<< HEAD

const { mockSessionFindUnique, mockCourseFindMany } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockCourseFindMany: vi.fn(),
=======
import type { RankedItem } from "@/lib/ranking";

const { mockSessionFindUnique, mockLoadOpenWork } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockLoadOpenWork: vi.fn(),
>>>>>>> 570b29e1ee817294cfe55f1b81876b1a59861be2
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
<<<<<<< HEAD
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
=======
  },
}));

vi.mock("@/lib/ranking-data", () => ({
  loadOpenWork: mockLoadOpenWork,
}));

import { GET } from "./route";

const BAD_HOURS_MESSAGE = { error: "Hours filter must be a number between 0.5 and 12." };

function rankedItem(assignmentId: string, overrides: Partial<RankedItem> = {}): RankedItem {
  return {
    assignmentId,
    courseId: "course-1",
    courseName: "Algorithms",
    title: `Work ${assignmentId}`,
    dueAt: null,
    share: null,
    hours: null,
    graded: false,
    dueDay: null,
    overdue: false,
    score: null,
    boundary: null,
    ...overrides,
  };
}

function request(path = "/api/today", withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer session-token");
  }
  return new Request(`http://localhost${path}`, { headers });
}

function sessionRow(userId = "user-1") {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: userId, email: "student@example.com" },
>>>>>>> 570b29e1ee817294cfe55f1b81876b1a59861be2
  };
}

describe("GET /api/today", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
<<<<<<< HEAD
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
=======
    mockLoadOpenWork.mockReset().mockResolvedValue([]);
  });

  it("requires an app session", async () => {
    const response = await GET(request("/api/today", false));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockLoadOpenWork).not.toHaveBeenCalled();
  });

  it("loads open work for the authenticated student, so no other student's items can appear", async () => {
    await GET(request());

    expect(mockLoadOpenWork).toHaveBeenCalledTimes(1);
    expect(mockLoadOpenWork).toHaveBeenCalledWith("user-1", expect.any(Date));
  });

  it("returns every item in the loader's order with 1-based ranks and hoursFilter null", async () => {
    // Deliberately out of any naive sort order: the route must not re-rank.
    mockLoadOpenWork.mockResolvedValue([
      rankedItem("b", { title: "Essay", share: 90, score: 90 }),
      rankedItem("c", { title: "Attendance check", share: 0.5 }),
      rankedItem("a", {
        title: "Problem set",
        dueAt: new Date("2026-10-14T17:00:00.000Z"),
        dueDay: "2026-10-14",
        share: 10,
      }),
    ]);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(() => new Date(body.generatedAt).toISOString()).not.toThrow();
    expect(body.hoursFilter).toBeNull();
    expect(body.items.map((item: { assignmentId: string }) => item.assignmentId)).toEqual(["b", "c", "a"]);
    expect(body.items.map((item: { rank: number }) => item.rank)).toEqual([1, 2, 3]);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items[2]).toEqual({
      rank: 3,
      assignmentId: "a",
      courseId: "course-1",
      courseName: "Algorithms",
      title: "Problem set",
      dueAt: "2026-10-14T17:00:00.000Z",
      dueDay: "2026-10-14",
      overdue: false,
      share: 10,
      hours: null,
      estimated: false,
      score: null,
      reason: "Due today, 10 percent of your grade",
      boundary: null,
    });
  });

  it("passes each item's reason and letter-cutoff boundary through untouched", async () => {
    const boundary = { letter: "A", cutoff: 90, direction: "at-risk" as const, distance: 2 };
    mockLoadOpenWork.mockResolvedValue([
      rankedItem("a", { dueDay: "2026-10-14", dueAt: new Date("2026-10-14T17:00:00.000Z"), share: 15, boundary }),
      rankedItem("b"),
    ]);

    const response = await GET(request());
    const body = await response.json();
    const items = body.items as Array<{ assignmentId: string; reason: string; boundary: unknown }>;

    expect(items[0].boundary).toEqual(boundary);
    expect(items[0].reason).toBe("Due today, 15 percent of your grade, could drop you below an A");
    expect(items[1].boundary).toBeNull();
    expect(items[1].reason).toBe("No due date");
  });

  it("fills a plan by skipping an item that does not fit and keeping later smaller ones", async () => {
    // budgets tick: 2 fits, the second 2 would blow a 3-hour plan, 1 fits after it.
    mockLoadOpenWork.mockResolvedValue([
      rankedItem("a", { hours: 2 }),
      rankedItem("b", { hours: 2 }),
      rankedItem("c", { hours: 1 }),
    ]);

    const response = await GET(request("/api/today?hours=3"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.map((item: { assignmentId: string; rank: number }) => [item.assignmentId, item.rank])).toEqual([
      ["a", 1],
      ["c", 3],
    ]);
    expect(body.hoursFilter).toEqual({ hours: 3, plannedHours: 3, unestimatedCount: 0, skippedCount: 1 });
  });

  it("bills an unestimated item as 1 hour and marks it estimated false", async () => {
    mockLoadOpenWork.mockResolvedValue([
      rankedItem("a", { hours: 2 }),
      rankedItem("b"),
      rankedItem("c", { hours: 2 }),
    ]);

    const response = await GET(request("/api/today?hours=3"));
    const body = await response.json();

    // The unestimated middle item costs the default 1 hour, so 2 + 1 fits and
    // the second 2-hour item has to go.
    expect(body.items.map((item: { assignmentId: string; estimated: boolean; rank: number }) => [
      item.assignmentId,
      item.rank,
      item.estimated,
    ])).toEqual([
      ["a", 1, true],
      ["b", 2, false],
    ]);
    expect(body.hoursFilter).toEqual({ hours: 3, plannedHours: 3, unestimatedCount: 1, skippedCount: 1 });
  });

  it("keeps nothing and reports an empty plan when nothing fits the budget", async () => {
    mockLoadOpenWork.mockResolvedValue([rankedItem("a", { hours: 2 })]);

    const response = await GET(request("/api/today?hours=0.5"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.hoursFilter).toEqual({ hours: 0.5, plannedHours: 0, unestimatedCount: 0, skippedCount: 1 });
  });

  it("counts every ranked item as skipped when the budget fits nothing, and the counts total the full list", async () => {
    mockLoadOpenWork.mockResolvedValue([
      rankedItem("a"),
      rankedItem("b"),
      rankedItem("c"),
    ]);

    const response = await GET(request("/api/today?hours=0.5"));
    const body = await response.json();

    // Nothing is stored for any estimate yet, so each item bills 1 hour, past
    // a half-hour budget; the empty plan still accounts for all of them.
    expect(response.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.hoursFilter).toEqual({ hours: 0.5, plannedHours: 0, unestimatedCount: 0, skippedCount: 3 });
    expect((body.items as unknown[]).length + body.hoursFilter.skippedCount).toBe(3);
  });

  it.each([
    "hours=0",
    "hours=0.4",
    "hours=13",
    "hours=abc",
    "hours=3&hours=3",
  ])("rejects an unusable hours filter (%s)", async (query: string) => {
    const response = await GET(request(`/api/today?${query}`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(BAD_HOURS_MESSAGE);
    expect(mockLoadOpenWork).not.toHaveBeenCalled();
>>>>>>> 570b29e1ee817294cfe55f1b81876b1a59861be2
  });
});
