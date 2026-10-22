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

import { GET, dynamic } from "./route";

const EXPECTED_SELECT = {
  id: true,
  name: true,
  courseCode: true,
  term: true,
  gradeSetup: {
    select: {
      categories: true,
      assignmentMappings: true,
      finalExamWeight: true,
      cutoffs: true,
      classDetails: true,
      confirmedAt: true,
    },
  },
  assignments: {
    select: {
      id: true,
      pointsPossible: true,
      grade: { select: { score: true } },
    },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  },
};

function request(withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer session-token");
  }
  return new Request("http://localhost/api/courses/course-1/grade", { headers });
}

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

const context = { params: Promise.resolve({ courseId: "course-1" }) };

const setupRow = {
  categories: [
    { name: "Homework", weight: 40 },
    { name: "Exams", weight: 60 },
  ],
  assignmentMappings: [
    { assignmentId: "hw-1", category: "Homework" },
    { assignmentId: "hw-2", category: "Homework" },
    { assignmentId: "exam-1", category: "Exams" },
  ],
  finalExamWeight: 0,
  cutoffs: { A: 90, B: 80 },
  classDetails: { section: "002" },
  confirmedAt: new Date("2026-10-11T18:30:00.000Z"),
};

function courseRow(overrides: { gradeSetup?: unknown; assignments?: unknown } = {}) {
  return {
    id: "course-1",
    name: "Algorithms",
    courseCode: "CS-341",
    term: "Fall 2026",
    gradeSetup: "gradeSetup" in overrides ? overrides.gradeSetup : setupRow,
    assignments: "assignments" in overrides ? overrides.assignments : [],
  };
}

const weightedAssignments = [
  { id: "hw-1", pointsPossible: 50, grade: { score: 45 } },
  { id: "hw-2", pointsPossible: 50, grade: { score: 36 } },
  { id: "exam-1", pointsPossible: 150, grade: { score: 120 } },
];

describe("GET /api/courses/[courseId]/grade", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockCourseFindFirst.mockReset().mockResolvedValue(courseRow({ assignments: weightedAssignments }));
  });

  it("returns the overall weighted percentage and the per-category breakdown", async () => {
    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    // Homework: 81/100 = 81%, Exams: 120/150 = 80%, overall (81*40 + 80*60)/100 = 80.4.
    // Shares: hw-1 and hw-2 split Homework's 40 evenly; exam-1 carries all of Exams' 60.
    expect(body).toEqual({
      course: { id: "course-1", name: "Algorithms", courseCode: "CS-341", term: "Fall 2026" },
      setupConfirmed: true,
      engine: "weighted",
      grade: { status: "calculated", percentage: 80.4 },
      breakdown: [
        { category: "Homework", weight: 40, percentage: 81, pointsEarned: 81, pointsPossible: 100, gradedCount: 2, ungradedCount: 0 },
        { category: "Exams", weight: 60, percentage: 80, pointsEarned: 120, pointsPossible: 150, gradedCount: 1, ungradedCount: 0 },
      ],
      finalExam: { status: "no-final" },
      shares: [
        { assignmentId: "hw-1", share: 20, category: "Homework" },
        { assignmentId: "hw-2", share: 20, category: "Homework" },
        { assignmentId: "exam-1", share: 60, category: "Exams" },
      ],
    });
  });

  it("loads the course, its setup, and its graded assignments in one query", async () => {
    await GET(request(), context);

    expect(mockCourseFindFirst).toHaveBeenCalledTimes(1);
    expect(mockCourseFindFirst).toHaveBeenCalledWith({
      where: { id: "course-1", userId: "user-1", isCurrent: true },
      select: EXPECTED_SELECT,
    });
  });

  it("returns a percentage with an empty breakdown for a points-based course with no setup", async () => {
    mockCourseFindFirst.mockResolvedValue(
      courseRow({
        gradeSetup: null,
        assignments: [
          { id: "hw-1", pointsPossible: 10, grade: { score: 9 } },
          { id: "proj-1", pointsPossible: 30, grade: { score: 21 } },
        ],
      }),
    );

    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      course: { id: "course-1", name: "Algorithms", courseCode: "CS-341", term: "Fall 2026" },
      setupConfirmed: false,
      engine: "points",
      grade: { status: "calculated", percentage: 75 },
      breakdown: [],
      finalExam: { status: "no-final" },
      shares: [
        { assignmentId: "hw-1", share: 25, category: null },
        { assignmentId: "proj-1", share: 75, category: null },
      ],
    });
  });

  it("carries the reason through when the engine cannot express the course's grading rule", async () => {
    mockCourseFindFirst.mockResolvedValue(
      courseRow({
        assignments: [
          { id: "hw-1", pointsPossible: 50, grade: { score: 45 } },
          { id: "exam-1", pointsPossible: 100, grade: { score: 110 } },
        ],
      }),
    );

    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.grade).toEqual({ status: "unsupported", reason: "extra-credit" });
    expect(body.engine).toBe("weighted");
    expect(body.breakdown).toEqual([]);
  });

  it("returns insufficient-data, with an all-null breakdown, when nothing is graded yet", async () => {
    mockCourseFindFirst.mockResolvedValue(
      courseRow({
        assignments: [
          { id: "hw-1", pointsPossible: 50, grade: null },
          { id: "exam-1", pointsPossible: 150, grade: { score: null } },
        ],
      }),
    );

    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      course: { id: "course-1", name: "Algorithms", courseCode: "CS-341", term: "Fall 2026" },
      setupConfirmed: true,
      engine: "weighted",
      grade: { status: "insufficient-data" },
      breakdown: [
        { category: "Homework", weight: 40, percentage: null, pointsEarned: 0, pointsPossible: 0, gradedCount: 0, ungradedCount: 1 },
        { category: "Exams", weight: 60, percentage: null, pointsEarned: 0, pointsPossible: 0, gradedCount: 0, ungradedCount: 1 },
      ],
      finalExam: { status: "no-final" },
      // hw-2 is mapped but has no assignment row, so hw-1 carries all of Homework's 40.
      shares: [
        { assignmentId: "hw-1", share: 40, category: "Homework" },
        { assignmentId: "exam-1", share: 60, category: "Exams" },
      ],
    });
  });

  it("keeps a category with nothing graded distinct from a category that scored zero", async () => {
    mockCourseFindFirst.mockResolvedValue(
      courseRow({
        assignments: [
          { id: "hw-1", pointsPossible: 50, grade: { score: 0 } },
          { id: "exam-1", pointsPossible: 150, grade: { score: null } },
        ],
      }),
    );

    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.grade).toEqual({ status: "calculated", percentage: 0 });
    expect(body.breakdown).toEqual([
      { category: "Homework", weight: 40, percentage: 0, pointsEarned: 0, pointsPossible: 50, gradedCount: 1, ungradedCount: 0 },
      { category: "Exams", weight: 60, percentage: null, pointsEarned: 0, pointsPossible: 0, gradedCount: 0, ungradedCount: 1 },
    ]);
  });

  it("grades with the points engine when the saved setup has no usable category weights", async () => {
    mockCourseFindFirst.mockResolvedValue(
      courseRow({
        gradeSetup: { ...setupRow, categories: [{ name: "Homework", weight: 0 }], finalExamWeight: 100 },
        assignments: [
          { id: "hw-1", pointsPossible: 10, grade: { score: 9 } },
          { id: "hw-2", pointsPossible: 30, grade: { score: 21 } },
        ],
      }),
    );

    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      course: { id: "course-1", name: "Algorithms", courseCode: "CS-341", term: "Fall 2026" },
      setupConfirmed: true,
      engine: "points",
      grade: { status: "calculated", percentage: 75 },
      breakdown: [],
      finalExam: { status: "no-final" },
      shares: [
        { assignmentId: "hw-1", share: 25, category: null },
        { assignmentId: "hw-2", share: 75, category: null },
      ],
    });
  });

  it("adds what the final exam is worth for each letter when the setup picked one", async () => {
    mockCourseFindFirst.mockResolvedValue(
      courseRow({
        gradeSetup: {
          categories: [
            { name: "Homework", weight: 40 },
            { name: "Final Exam", weight: 60 },
          ],
          assignmentMappings: [
            { assignmentId: "hw-1", category: "Homework" },
            { assignmentId: "final-1", category: "Final Exam" },
          ],
          finalExamWeight: 0,
          cutoffs: { A: 90 },
          classDetails: { finalExamAssignmentId: "final-1" },
          confirmedAt: new Date("2026-10-11T18:30:00.000Z"),
        },
        assignments: [
          { id: "hw-1", pointsPossible: 100, grade: { score: 80 } },
          { id: "final-1", pointsPossible: 100, grade: null },
        ],
      }),
    );

    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.finalExam).toEqual({
      status: "solved",
      // Homework: 80%, Final Exam: 60% weight, so an A needs 32 + 0.6x >= 90,
      // that is 96.67 points of the 100-point final, rounded up.
      results: [{ letter: "A", status: "needed", score: 96.67, percent: 96.7 }],
      otherWorkPending: false,
    });
  });

  it("does not solve for a final whose weight is held outside the categories", async () => {
    mockCourseFindFirst.mockResolvedValue(
      courseRow({
        gradeSetup: {
          categories: [{ name: "Homework", weight: 40 }],
          assignmentMappings: [{ assignmentId: "hw-1", category: "Homework" }],
          finalExamWeight: 60,
          cutoffs: { A: 90, B: 80 },
          classDetails: { finalExamAssignmentId: "final-1" },
          confirmedAt: new Date("2026-10-11T18:30:00.000Z"),
        },
        assignments: [
          { id: "hw-1", pointsPossible: 100, grade: { score: 80 } },
          { id: "final-1", pointsPossible: 100, grade: null },
        ],
      }),
    );

    const response = await GET(request(), context);
    const body = await response.json();

    expect(body.finalExam).toEqual({ status: "final-not-counted" });
  });

  it("does not return another user's or a non-current course", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Current course not found." });
  });

  it("requires an app session", async () => {
    const response = await GET(request(false), context);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });

  it("opts out of caching", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
