import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindMany,
  mockUserUpdate,
  mockGetCanvasToken,
  mockImportCourses,
  mockImportAssignmentGroups,
  mockImportAssignments,
  mockImportGrades,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockGetCanvasToken: vi.fn(),
  mockImportCourses: vi.fn(),
  mockImportAssignmentGroups: vi.fn(),
  mockImportAssignments: vi.fn(),
  mockImportGrades: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: { findMany: mockFindMany },
    user: { update: mockUserUpdate },
  },
}));

vi.mock("@/lib/canvas-credentials", () => ({
  getCanvasToken: mockGetCanvasToken,
}));

vi.mock("./courses", () => ({ importCourses: mockImportCourses }));

vi.mock("./assignment-groups", () => ({ importAssignmentGroups: mockImportAssignmentGroups }));

vi.mock("./assignments", () => ({ importAssignments: mockImportAssignments }));

vi.mock("./grades", () => ({ importGrades: mockImportGrades }));

import { syncUser } from "./sync";

const USER_ID = "user-1";
const CREDENTIALS = { baseUrl: "https://canvas.example.edu", token: "canvas-token-123" };
const CLOCKS_AT = "2026-10-07T19:00:00Z";

function storedCourse(id: string) {
  return { id, userId: USER_ID, canvasId: id.replace("course", "canvas") };
}

describe("syncUser", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockUserUpdate.mockReset();
    mockUserUpdate.mockResolvedValue({});
    mockGetCanvasToken.mockReset();
    mockGetCanvasToken.mockResolvedValue(CREDENTIALS);
    mockImportCourses.mockReset();
    mockImportAssignmentGroups.mockReset();
    mockImportAssignments.mockReset();
    mockImportGrades.mockReset();
    vi.setSystemTime(new Date(CLOCKS_AT));
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs the stages in order courses, then groups, assignments, grades per stored course", async () => {
    const order: string[] = [];
    mockImportCourses.mockImplementation(async () => {
      order.push("courses");
      return { imported: 2, skipped: 0, courseIds: ["c1", "c2"] };
    });
    mockFindMany.mockResolvedValue([storedCourse("course-1"), storedCourse("course-2")]);
    mockImportAssignmentGroups.mockImplementation(async () => {
      order.push("assignment groups");
      return { imported: 1 };
    });
    mockImportAssignments.mockImplementation(async () => {
      order.push("assignments");
      return { imported: 1, skipped: 0 };
    });
    mockImportGrades.mockImplementation(async () => {
      order.push("grades");
      return { imported: 1, skipped: 0 };
    });
    await syncUser(USER_ID);
    expect(order).toEqual([
      "courses",
      "assignment groups",
      "assignments",
      "grades",
      "assignment groups",
      "assignments",
      "grades",
    ]);
    expect(mockImportCourses).toHaveBeenCalledWith(USER_ID);
    expect(mockImportAssignmentGroups).toHaveBeenNthCalledWith(
      1,
      CREDENTIALS,
      expect.objectContaining({ id: "course-1" })
    );
    expect(mockImportGrades).toHaveBeenLastCalledWith(
      CREDENTIALS,
      expect.objectContaining({ id: "course-2" })
    );
  });

  it("aggregates the per-course counts and writes lastSyncedAt on success", async () => {
    mockImportCourses.mockResolvedValue({ imported: 2, skipped: 1, courseIds: ["c1", "c2"] });
    mockFindMany.mockResolvedValue([storedCourse("course-1"), storedCourse("course-2")]);
    mockImportAssignmentGroups.mockResolvedValueOnce({ imported: 3 }).mockResolvedValueOnce({ imported: 4 });
    mockImportAssignments
      .mockResolvedValueOnce({ imported: 5, skipped: 1 })
      .mockResolvedValueOnce({ imported: 6, skipped: 2 });
    mockImportGrades.mockResolvedValueOnce({ imported: 7, skipped: 0 }).mockResolvedValueOnce({ imported: 8, skipped: 1 });
    await expect(syncUser(USER_ID)).resolves.toEqual({
      lastSyncedAt: new Date(CLOCKS_AT),
      courses: 2,
      assignmentGroups: 7,
      assignments: 11,
      grades: 15,
    });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ["c1", "c2"] } },
    });
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { lastSyncedAt: new Date(CLOCKS_AT) },
    });
  });

  it("leaves lastSyncedAt unwritten and propagates when the assignments stage fails", async () => {
    mockImportCourses.mockResolvedValue({ imported: 1, skipped: 0, courseIds: ["c1"] });
    mockFindMany.mockResolvedValue([storedCourse("course-1")]);
    mockImportAssignmentGroups.mockResolvedValue({ imported: 2 });
    mockImportAssignments.mockRejectedValue(new Error("Canvas returned 500 for assignments"));
    mockImportGrades.mockResolvedValue({ imported: 1, skipped: 0 });
    await expect(syncUser(USER_ID)).rejects.toThrow("Canvas returned 500 for assignments");
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockImportGrades).not.toHaveBeenCalled();
  });

  it("processes only the courses importCourses kept, so a prior term is not synced again", async () => {
    mockImportCourses.mockResolvedValue({ imported: 1, skipped: 40, courseIds: ["c-current"] });
    mockFindMany.mockResolvedValue([storedCourse("course-current")]);
    mockImportAssignmentGroups.mockResolvedValue({ imported: 1 });
    mockImportAssignments.mockResolvedValue({ imported: 1, skipped: 0 });
    mockImportGrades.mockResolvedValue({ imported: 1, skipped: 0 });
    await syncUser(USER_ID);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: ["c-current"] } },
    });
    expect(mockImportAssignments).toHaveBeenCalledTimes(1);
  });

  it("throws without running any stage when Canvas is not connected", async () => {
    mockGetCanvasToken.mockResolvedValue(null);
    await expect(syncUser(USER_ID)).rejects.toThrow("Canvas not connected");
    expect(mockImportCourses).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
