import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCourseFindUnique, mockCreate, mockUpdateMany, mockDeleteMany } = vi.hoisted(() => ({
  mockCourseFindUnique: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockDeleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: { findUnique: mockCourseFindUnique },
    courseGradeSetup: { create: mockCreate, updateMany: mockUpdateMany, deleteMany: mockDeleteMany },
  },
}));

import { applyCanvasSetup } from "./canvas-setup";

const COURSE_ID = "course-1";
const GROUPS = [
  { name: "Homework", groupWeight: 40, hasDropRules: false },
  { name: "Projects", groupWeight: 60, hasDropRules: false },
];

function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    applyGroupWeights: true,
    assignmentGroups: GROUPS,
    assignments: [
      { id: "a1", assignmentGroup: { name: "Homework" } },
      { id: "a2", assignmentGroup: { name: "Projects" } },
    ],
    gradeSetup: null,
    ...overrides,
  };
}

const BUILT_SETUP = {
  categories: [
    { name: "Homework", weight: 40 },
    { name: "Projects", weight: 60 },
  ],
  assignmentMappings: [
    { assignmentId: "a1", category: "Homework" },
    { assignmentId: "a2", category: "Projects" },
  ],
  finalExamWeight: 0,
  cutoffs: {},
  classDetails: {},
  unsupportedRules: [],
};

function canvasSetupRow(overrides: Record<string, unknown> = {}) {
  return {
    courseId: COURSE_ID,
    categories: BUILT_SETUP.categories,
    assignmentMappings: BUILT_SETUP.assignmentMappings,
    finalExamWeight: 0,
    cutoffs: { A: 90 },
    classDetails: { instructor: "Dr. Ruiz" },
    unsupportedRules: [],
    source: "canvas",
    confirmedAt: new Date("2026-11-10T12:00:00Z"),
    ...overrides,
  };
}

describe("applyCanvasSetup", () => {
  beforeEach(() => {
    mockCourseFindUnique.mockReset();
    mockCourseFindUnique.mockResolvedValue(courseRow());
    mockCreate.mockReset().mockResolvedValue({});
    mockUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    mockDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a confirmed setup sourced from Canvas when the course has none", async () => {
    await applyCanvasSetup(COURSE_ID);
    expect(mockCourseFindUnique).toHaveBeenCalledWith({
      where: { id: COURSE_ID },
      select: {
        applyGroupWeights: true,
        assignmentGroups: {
          select: { name: true, groupWeight: true, hasDropRules: true },
          orderBy: [{ position: "asc" }, { name: "asc" }],
        },
        assignments: {
          select: { id: true, assignmentGroup: { select: { name: true } } },
          orderBy: [{ title: "asc" }, { id: "asc" }],
        },
        gradeSetup: true,
      },
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ courseId: COURSE_ID, source: "canvas", ...BUILT_SETUP }),
    });
    expect(mockCreate.mock.calls[0][0].data.confirmedAt).toEqual(expect.any(Date));
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("a create that loses a race with the student's save yields quietly", async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    await expect(applyCanvasSetup(COURSE_ID)).resolves.toBeUndefined();
  });

  it("a create that fails for another reason still fails the sync", async () => {
    mockCreate.mockRejectedValue(new Error("database unreachable"));
    await expect(applyCanvasSetup(COURSE_ID)).rejects.toThrow("database unreachable");
  });

  it("never touches a setup the student confirmed by hand", async () => {
    mockCourseFindUnique.mockResolvedValue(courseRow({ gradeSetup: canvasSetupRow({ source: "student", categories: [{ name: "Mine", weight: 100 }] }) }));
    await applyCanvasSetup(COURSE_ID);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("updates a canvas-sourced setup when Canvas's weights changed, writing only what Canvas states", async () => {
    mockCourseFindUnique.mockResolvedValue(
      courseRow({
        assignmentGroups: [
          { name: "Homework", groupWeight: 50, hasDropRules: false },
          { name: "Projects", groupWeight: 50, hasDropRules: false },
        ],
        gradeSetup: canvasSetupRow(),
      }),
    );
    await applyCanvasSetup(COURSE_ID);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { courseId: COURSE_ID, source: "canvas" },
      data: {
        categories: [
          { name: "Homework", weight: 50 },
          { name: "Projects", weight: 50 },
        ],
        assignmentMappings: BUILT_SETUP.assignmentMappings,
        finalExamWeight: 0,
        confirmedAt: expect.any(Date),
      },
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("updates a canvas-sourced setup when only an assignment mapping changed", async () => {
    mockCourseFindUnique.mockResolvedValue(
      courseRow({
        assignments: [
          { id: "a1", assignmentGroup: { name: "Projects" } },
          { id: "a2", assignmentGroup: { name: "Projects" } },
          { id: "a3", assignmentGroup: { name: "Homework" } },
        ],
        gradeSetup: canvasSetupRow(),
      }),
    );
    await applyCanvasSetup(COURSE_ID);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany.mock.calls[0][0].data.assignmentMappings).toEqual([
      { assignmentId: "a1", category: "Projects" },
      { assignmentId: "a2", category: "Projects" },
      { assignmentId: "a3", category: "Homework" },
    ]);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("deletes a canvas-sourced setup once the weights no longer total 100", async () => {
    mockCourseFindUnique.mockResolvedValue(
      courseRow({
        assignmentGroups: [
          { name: "Homework", groupWeight: 40, hasDropRules: false },
          { name: "Projects", groupWeight: 50, hasDropRules: false },
        ],
        gradeSetup: canvasSetupRow(),
      }),
    );
    await applyCanvasSetup(COURSE_ID);
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("deletes a canvas-sourced setup once a group carries a drop rule", async () => {
    mockCourseFindUnique.mockResolvedValue(
      courseRow({
        assignmentGroups: [
          { name: "Homework", groupWeight: 40, hasDropRules: true },
          { name: "Projects", groupWeight: 60, hasDropRules: false },
        ],
        gradeSetup: canvasSetupRow(),
      }),
    );
    await applyCanvasSetup(COURSE_ID);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { courseId: COURSE_ID, source: "canvas" } });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates nothing when a group carries a drop rule and no setup exists", async () => {
    mockCourseFindUnique.mockResolvedValue(
      courseRow({
        assignmentGroups: [
          { name: "Homework", groupWeight: 40, hasDropRules: true },
          { name: "Projects", groupWeight: 60, hasDropRules: false },
        ],
      }),
    );
    await applyCanvasSetup(COURSE_ID);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("writes nothing when the canvas-sourced setup already matches", async () => {
    mockCourseFindUnique.mockResolvedValue(courseRow({ gradeSetup: canvasSetupRow() }));
    await applyCanvasSetup(COURSE_ID);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("leaves a matching canvas-sourced setup's confirmedAt stable across syncs", async () => {
    const saved = canvasSetupRow({ confirmedAt: new Date("2026-11-14T09:00:00Z") });
    mockCourseFindUnique.mockResolvedValue(courseRow({ gradeSetup: saved }));
    await applyCanvasSetup(COURSE_ID);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("deletes a canvas-sourced setup once Canvas no longer states complete weights", async () => {
    mockCourseFindUnique.mockResolvedValue(
      courseRow({
        applyGroupWeights: false,
        gradeSetup: canvasSetupRow(),
      }),
    );
    await applyCanvasSetup(COURSE_ID);
    // Scoped to source "canvas" so a student row saved mid-sync survives.
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { courseId: COURSE_ID, source: "canvas" } });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("does nothing when Canvas states nothing and no setup exists", async () => {
    mockCourseFindUnique.mockResolvedValue(courseRow({ applyGroupWeights: false }));
    await applyCanvasSetup(COURSE_ID);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("repairs a canvas-sourced row the database holds in an invalid shape", async () => {
    mockCourseFindUnique.mockResolvedValue(
      courseRow({ gradeSetup: canvasSetupRow({ categories: "not-a-list" }) }),
    );
    await applyCanvasSetup(COURSE_ID);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("returns quietly when the course is gone", async () => {
    mockCourseFindUnique.mockResolvedValue(null);
    await expect(applyCanvasSetup(COURSE_ID)).resolves.toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
