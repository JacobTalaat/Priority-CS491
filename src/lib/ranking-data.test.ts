import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCourseFindMany } = vi.hoisted(() => ({
  mockCourseFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: { findMany: mockCourseFindMany },
  },
}));

import { loadOpenWork } from "./ranking-data";

// 12:30 PM EDT on Wednesday 2026-10-14.
const NOW = new Date("2026-10-14T16:30:00.000Z");

function assignment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Work ${id}`,
    dueAt: null,
    hasDueDate: false,
    pointsPossible: 50,
    grade: null,
    ...overrides,
  };
}

describe("loadOpenWork", () => {
  beforeEach(() => {
    mockCourseFindMany.mockReset().mockResolvedValue([]);
  });

  it("queries only the user's current courses", async () => {
    await loadOpenWork("user-1", NOW);

    expect(mockCourseFindMany).toHaveBeenCalledTimes(1);
    expect(mockCourseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", isCurrent: true } }),
    );
  });

  it("ranks assignments of a weighted course by the shares the setup implies", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        gradeSetup: {
          categories: [{ name: "Homework", weight: 100 }],
          assignmentMappings: [
            { assignmentId: "hw-1", category: "Homework" },
            { assignmentId: "hw-2", category: "Homework" },
          ],
          finalExamWeight: 0,
          cutoffs: {},
          classDetails: {},
        },
        assignments: [
          assignment("hw-1", {
            title: "Problem set",
            dueAt: new Date("2026-10-14T17:00:00-04:00"),
            hasDueDate: true,
          }),
          assignment("hw-2", {
            title: "Quiz",
            dueAt: new Date("2026-10-14T18:00:00-04:00"),
            hasDueDate: true,
            grade: { score: 48 },
          }),
        ],
      },
    ]);

    const ranked = await loadOpenWork("user-1", NOW);

    // Homework splits evenly, and the graded quiz is dropped from the list.
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toEqual({
      assignmentId: "hw-1",
      courseId: "course-1",
      courseName: "Algorithms",
      title: "Problem set",
      dueAt: new Date("2026-10-14T17:00:00-04:00"),
      share: 50,
      hours: null,
      graded: false,
      dueDay: "2026-10-14",
      overdue: false,
      score: 50,
    });
  });

  it("falls back to points shares when the saved setup does not validate", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        gradeSetup: { categories: [] },
        assignments: [
          assignment("hw-1", {
            title: "Problem set",
            dueAt: new Date("2026-10-14T17:00:00-04:00"),
            hasDueDate: true,
            pointsPossible: 10,
          }),
          assignment("hw-2", { pointsPossible: 30 }),
        ],
      },
    ]);

    const ranked = await loadOpenWork("user-1", NOW);

    // 10 of 40 points = 25%.
    expect(ranked[0]).toMatchObject({ assignmentId: "hw-1", share: 25, score: 25 });
  });

  it("treats an assignment with hasDueDate false as having no due date, even with a dueAt", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        gradeSetup: null,
        assignments: [
          assignment("undated", {
            title: "Paper",
            dueAt: new Date("2026-10-14T17:00:00-04:00"),
            hasDueDate: false,
          }),
          assignment("dated", {
            title: "Lab",
            dueAt: new Date("2026-10-14T18:00:00-04:00"),
            hasDueDate: true,
          }),
        ],
      },
    ]);

    const ranked = await loadOpenWork("user-1", NOW);

    expect(ranked.map((entry) => [entry.assignmentId, entry.dueDay, entry.dueAt])).toEqual([
      ["dated", "2026-10-14", new Date("2026-10-14T18:00:00-04:00")],
      ["undated", null, null],
    ]);
  });

  it("leaves out work the student already handed in, even before a grade lands", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        gradeSetup: null,
        assignments: [
          assignment("handed-in", {
            title: "Essay",
            dueAt: new Date("2026-10-14T17:00:00-04:00"),
            hasDueDate: true,
            grade: { score: null, submittedAt: new Date("2026-10-13T22:00:00Z"), excused: false },
          }),
          assignment("open", {
            title: "Lab",
            dueAt: new Date("2026-10-14T18:00:00-04:00"),
            hasDueDate: true,
          }),
        ],
      },
    ]);

    const ranked = await loadOpenWork("user-1", NOW);

    expect(ranked.map((entry) => [entry.assignmentId, entry.dueAt, entry.graded])).toEqual([
      ["open", new Date("2026-10-14T18:00:00-04:00"), false],
    ]);
  });

  it("leaves out excused work", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        gradeSetup: null,
        assignments: [
          assignment("excused", {
            title: "Discussion post",
            dueAt: new Date("2026-10-14T17:00:00-04:00"),
            hasDueDate: true,
            grade: { score: null, submittedAt: null, excused: true },
          }),
          assignment("open", {
            title: "Lab",
            dueAt: new Date("2026-10-14T18:00:00-04:00"),
            hasDueDate: true,
          }),
        ],
      },
    ]);

    const ranked = await loadOpenWork("user-1", NOW);

    expect(ranked.map((entry) => entry.assignmentId)).toEqual(["open"]);
  });

  it("selects the fields it needs to spot handed-in and excused grades", async () => {
    await loadOpenWork("user-1", NOW);

    const select = mockCourseFindMany.mock.calls[0][0].select;
    expect(select.assignments.select.grade.select).toEqual({
      score: true,
      submittedAt: true,
      excused: true,
    });
  });

  it("returns nothing and does not blow up when a course has no assignments", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        gradeSetup: null,
        assignments: [],
      },
    ]);

    await expect(loadOpenWork("user-1", NOW)).resolves.toEqual([]);
  });
});
