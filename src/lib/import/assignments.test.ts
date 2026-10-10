import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockFindMany } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignment: { upsert: mockUpsert },
    assignmentGroup: { findMany: mockFindMany },
  },
}));

import { importAssignments } from "./assignments";
import type { Course } from "@/generated/prisma/client";

const BASE_URL = "https://canvas.example.edu";
const TOKEN = "canvas-token-123";
const PATH = "/api/v1/courses/67506/assignments?per_page=100";

const COURSE = {
  id: "course-1",
  canvasId: "67506",
} as unknown as Course;

const CREDENTIALS = { baseUrl: BASE_URL, token: TOKEN };

const STORED_GROUPS = [
  { id: "group-local-1", canvasId: "190823" },
  { id: "group-local-2", canvasId: "199451" },
];

function assignment(
  id: number,
  name: string,
  pointsPossible: number | null,
  dueAt: string | null,
  assignmentGroupId: number | null = 190823
): Record<string, unknown> {
  return {
    id,
    name,
    points_possible: pointsPossible,
    due_at: dueAt,
    assignment_group_id: assignmentGroupId,
    html_url: `${BASE_URL}/courses/67506/assignments/${id}`,
  };
}

function linkHeader(page: number): string {
  return `<${BASE_URL}/api/v1/courses/67506/assignments?page=${page}&per_page=100>; rel="next"`;
}

function singlePage(items: Record<string, unknown>[]) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(items), { status: 200 }));
}

describe("importAssignments", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue(STORED_GROUPS);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips an assignment with points_possible: 0", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712331, "Academic Engagement: Fall 2026", 0, "2026-10-12T03:59:00Z"),
      assignment(712332, "Project proposal", 100, "2026-10-19T03:59:00Z"),
    ]));
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 1 });
    const canvasIds = mockUpsert.mock.calls.map((c) => c[0].where.courseId_canvasId.canvasId);
    expect(canvasIds).toEqual(["712332"]);
  });

  it("skips an assignment with points_possible: null", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712333, "Ungraded note", null, "2026-10-12T03:59:00Z"),
      assignment(712332, "Project proposal", 100, "2026-10-19T03:59:00Z"),
    ]));
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 1 });
  });

  it("stores an assignment with due_at: null, kept and marked", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712334, "No deadline survey", 100, null),
    ]));
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 0 });
    expect(mockUpsert.mock.calls[0][0].update).toMatchObject({
      dueAt: null,
      hasDueDate: false,
    });
  });

  it("stores a real due_at parsed to a Date with hasDueDate: true", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712335, "Labs 1", 100, "2026-09-28T03:59:00Z"),
    ]));
    await importAssignments(CREDENTIALS, COURSE);
    expect(mockUpsert.mock.calls[0][0].update).toMatchObject({
      dueAt: new Date("2026-09-28T03:59:00Z"),
      hasDueDate: true,
    });
  });

  it("treats an unparseable due_at as no due date so dueAt and hasDueDate agree", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712337, "Broken date", 100, "not-a-date"),
    ]));
    await importAssignments(CREDENTIALS, COURSE);
    expect(mockUpsert.mock.calls[0][0].update).toMatchObject({
      dueAt: null,
      hasDueDate: false,
    });
  });

  it("maps assignment_group_id to the local group id", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712336, "Labs 2", 100, "2026-10-05T03:59:00Z", 199451),
    ]));
    await importAssignments(CREDENTIALS, COURSE);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { courseId: "course-1" },
      select: { id: true, canvasId: true },
    });
    expect(mockUpsert.mock.calls[0][0].update.assignmentGroupId).toBe("group-local-2");
  });

  it("stores assignmentGroupId: null for an unknown group without throwing", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712337, "Orphan item", 100, "2026-10-12T03:59:00Z", 999999),
    ]));
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 0 });
    expect(mockUpsert.mock.calls[0][0].update.assignmentGroupId).toBeNull();
  });

  it("puts Canvas's name into our title column", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712338, "Midterm exam", 100, "2026-10-26T03:59:00Z", 199452),
    ]));
    await importAssignments(CREDENTIALS, COURSE);
    expect(mockUpsert.mock.calls[0][0].update.title).toBe("Midterm exam");
  });

  it("consumes three mocked pages, requesting per_page=100", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([assignment(1, "A", 100, null)]), { status: 200, headers: { Link: linkHeader(2) } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([assignment(2, "B", 100, null)]), { status: 200, headers: { Link: linkHeader(3) } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([assignment(3, "C", 100, null)]), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 3, skipped: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE_URL}${PATH}`);
    expect(mockFetch.mock.calls[1][0]).toBe(`${BASE_URL}/api/v1/courses/67506/assignments?page=2&per_page=100`);
    expect(mockFetch.mock.calls[2][0]).toBe(`${BASE_URL}/api/v1/courses/67506/assignments?page=3&per_page=100`);
  });

  it("re-runs identically, upserting with the same where values", async () => {
    const items = [
      assignment(712339, "Project (Technical Delivery)", 100, "2026-11-09T03:59:00Z", 199455),
      assignment(712334, "No deadline survey", 100, null),
    ];
    vi.stubGlobal("fetch", singlePage(items));
    const first = await importAssignments(CREDENTIALS, COURSE);
    const firstCalls = [...mockUpsert.mock.calls];
    vi.stubGlobal("fetch", singlePage(items));
    const second = await importAssignments(CREDENTIALS, COURSE);
    expect(first).toEqual(second);
    expect(first).toEqual({ imported: 2, skipped: 0 });
    expect(mockUpsert).toHaveBeenCalledTimes(4);
    const firstWheres = firstCalls.map((c) => c[0].where);
    const secondWheres = mockUpsert.mock.calls.slice(2).map((c) => c[0].where);
    expect(secondWheres).toEqual(firstWheres);
    expect(secondWheres[0]).toEqual({
      courseId_canvasId: { courseId: "course-1", canvasId: "712339" },
    });
  });

  it("matches the real-course counts: 8 items with 1 at 0.0 and 2 without due dates", async () => {
    const items = [
      assignment(712331, "Academic Engagement: Fall 2026", 0, "2026-10-12T03:59:00Z", 190823),
      assignment(712334, "No deadline survey", 100, null),
      assignment(712332, "Project proposal", 100, "2026-10-19T03:59:00Z"),
      assignment(712340, "Second undated item", 100, null),
      assignment(712341, "Labs 1", 100, "2026-09-28T03:59:00Z"),
      assignment(712342, "Labs 2", 100, "2026-09-28T03:59:00Z"),
      assignment(712343, "Midterm exam", 100, "2026-10-26T03:59:00Z"),
      assignment(712344, "Final exam", 100, "2026-12-14T03:59:00Z"),
    ];
    vi.stubGlobal("fetch", singlePage(items));
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 7, skipped: 1 });
    expect(mockUpsert).toHaveBeenCalledTimes(7);
    const kept = mockUpsert.mock.calls.map((c) => c[0].where.courseId_canvasId.canvasId);
    expect(kept).toEqual(["712334", "712332", "712340", "712341", "712342", "712343", "712344"]);
  });
});
