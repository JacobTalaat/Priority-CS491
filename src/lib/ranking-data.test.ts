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
import { rankOpenWork, type OpenWorkItem, type RankedItem } from "./ranking";

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
      boundary: null,
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

  it("flags open items at risk of dropping below a letter cutoff", async () => {
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
          cutoffs: { A: 90, F: 0 },
          classDetails: {},
        },
        assignments: [
          assignment("hw-1", { title: "Problem set" }),
          assignment("hw-2", { title: "Quiz", grade: { score: 45 } }),
        ],
      },
    ]);

    const ranked = await loadOpenWork("user-1", NOW);

    // 45 of 50 points = 90%, so the open work could drop the grade below an A.
    expect(ranked).toHaveLength(1);
    expect(ranked[0].boundary).toEqual({
      letter: "A",
      cutoff: 90,
      direction: "at-risk",
      distance: 0,
    });
  });

  it("gives no flags when the grade cannot be calculated", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        gradeSetup: {
          categories: [{ name: "Homework", weight: 100 }],
          assignmentMappings: [{ assignmentId: "hw-1", category: "Homework" }],
          finalExamWeight: 0,
          cutoffs: { A: 90 },
          classDetails: {},
        },
        assignments: [assignment("hw-1", { title: "Problem set" })],
      },
    ]);

    const ranked = await loadOpenWork("user-1", NOW);

    // Nothing graded yet: the percentage is unknown, so no flag is honest.
    expect(ranked[0]).toMatchObject({ assignmentId: "hw-1", boundary: null });
  });

  it("gives no flag to an item with zero share, even when the course would flag", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        gradeSetup: {
          categories: [{ name: "Homework", weight: 100 }],
          assignmentMappings: [
            { assignmentId: "hw-done", category: "Homework" },
            { assignmentId: "hw-zero", category: "Homework" },
          ],
          finalExamWeight: 0,
          cutoffs: { A: 99, F: 0 },
          classDetails: {},
        },
        assignments: [
          assignment("hw-done", { title: "Quiz", pointsPossible: 100, grade: { score: 100 } }),
          assignment("hw-zero", { title: "Attendance check", pointsPossible: 0 }),
        ],
      },
    ]);

    const ranked = await loadOpenWork("user-1", NOW);

    // The course sits at 100%, a point from losing the A- (99 cutoff), but a
    // zero-point item cannot move the grade either way.
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ assignmentId: "hw-zero", share: 0, boundary: null });
  });

  it("gives no flags while a final exam weight sits outside the categories", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        gradeSetup: {
          categories: [{ name: "Homework", weight: 70 }],
          assignmentMappings: [
            { assignmentId: "hw-1", category: "Homework" },
            { assignmentId: "hw-2", category: "Homework" },
          ],
          finalExamWeight: 30,
          cutoffs: { A: 90 },
          classDetails: {},
        },
        assignments: [
          assignment("hw-1", { title: "Problem set" }),
          assignment("hw-2", { title: "Quiz", grade: { score: 45 } }),
        ],
      },
    ]);

    const ranked = await loadOpenWork("user-1", NOW);

    // 90% so far, but the final is 30% of the real grade and ungraded, so any
    // cutoff flag would be provisional.
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ assignmentId: "hw-1", boundary: null });
  });

  it("adds flags after ranking, leaving the order and scores identical", async () => {
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "Algorithms",
        gradeSetup: {
          categories: [{ name: "Homework", weight: 100 }],
          assignmentMappings: [
            { assignmentId: "hw-1", category: "Homework" },
            { assignmentId: "hw-2", category: "Homework" },
            { assignmentId: "hw-3", category: "Homework" },
          ],
          finalExamWeight: 0,
          cutoffs: { "A-": 89 },
          classDetails: {},
        },
        assignments: [
          assignment("hw-1", {
            title: "Problem set",
            dueAt: new Date("2026-10-14T18:00:00-04:00"),
            hasDueDate: true,
          }),
          assignment("hw-2", {
            title: "Quiz",
            dueAt: new Date("2026-10-14T17:00:00-04:00"),
            hasDueDate: true,
          }),
          assignment("hw-3", { title: "Lab", grade: { score: 44.5 } }),
        ],
      },
    ]);

    const ranked = await loadOpenWork("user-1", NOW);

    // hw-1 and hw-2 sit next to an A- cutoff of 89: the category is 44.5 of 50
    // points, so 89% exactly, and both carry a flag while ranking on shares
    // (50 each of the 150-point category, the graded lab included).
    const plain = rankOpenWork(
      [
        {
          assignmentId: "hw-1",
          courseId: "course-1",
          courseName: "Algorithms",
          title: "Problem set",
          dueAt: new Date("2026-10-14T18:00:00-04:00"),
          share: 33.3333333333,
          hours: null,
          graded: false,
        },
        {
          assignmentId: "hw-2",
          courseId: "course-1",
          courseName: "Algorithms",
          title: "Quiz",
          dueAt: new Date("2026-10-14T17:00:00-04:00"),
          share: 33.3333333333,
          hours: null,
          graded: false,
        },
      ] satisfies OpenWorkItem[],
      NOW,
    );
    const withoutFlags = (entry: RankedItem): Record<string, unknown> =>
      Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "boundary"));
    expect(ranked.map(withoutFlags)).toEqual(plain.map(withoutFlags));
    expect(ranked.map((entry) => entry.boundary)).toEqual([
      { letter: "A-", cutoff: 89, direction: "at-risk", distance: 0 },
      { letter: "A-", cutoff: 89, direction: "at-risk", distance: 0 },
    ]);
  });
});

describe("loadOpenWork letter flags are true of each item", () => {
  function course(graded: number, open: number) {
    return {
      id: "course-1",
      name: "Algorithms",
      gradeSetup: {
        categories: [{ name: "Homework", weight: 100 }],
        assignmentMappings: [
          { assignmentId: "graded", category: "Homework" },
          { assignmentId: "open", category: "Homework" },
        ],
        finalExamWeight: 0,
        cutoffs: { "A-": 90, "B+": 87, F: 0 },
        classDetails: {},
      },
      assignments: [
        assignment("graded", { pointsPossible: 990, grade: { score: graded } }),
        assignment("open", { pointsPossible: open }),
      ],
    };
  }

  it("does not warn about an item too small to drop the grade below the cutoff", async () => {
    // 909.81/990 is 91.9%: near A-, but even 0/10 on the open item leaves 90.98%.
    mockCourseFindMany.mockResolvedValue([course(909.81, 10)]);
    const [item] = await loadOpenWork("user-1", NOW);
    expect(item.boundary).toBeNull();
  });

  it("warns when a zero on the item really would drop the grade below the cutoff", async () => {
    // 909.81/990 is 91.9%, and 0/100 on the open item drops it to 82.7%.
    mockCourseFindMany.mockResolvedValue([course(909.81, 100)]);
    const [item] = await loadOpenWork("user-1", NOW);
    expect(item.boundary).toMatchObject({ letter: "A-", direction: "at-risk" });
  });

  it("does not promise a letter an item cannot reach", async () => {
    // 872.19/990 is 88.1%, 1.9 below A-, but 10/10 more only reaches 88.2%.
    mockCourseFindMany.mockResolvedValue([course(872.19, 10)]);
    const [item] = await loadOpenWork("user-1", NOW);
    expect(item.boundary).toBeNull();
  });
});
