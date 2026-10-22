import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockFindMany, mockDeleteMany, mockCount } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindMany: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignment: { upsert: mockUpsert, deleteMany: mockDeleteMany, count: mockCount },
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
    mockDeleteMany.mockReset();
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockCount.mockReset();
    mockCount.mockResolvedValue(0);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("skips an assignment with points_possible: 0", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712331, "Academic Engagement: Fall 2026", 0, "2026-10-12T03:59:00Z"),
      assignment(712332, "Project proposal", 100, "2026-10-19T03:59:00Z"),
    ]));
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 1, removed: 0 });
    const canvasIds = mockUpsert.mock.calls.map((c) => c[0].where.courseId_canvasId.canvasId);
    expect(canvasIds).toEqual(["712332"]);
  });

  it("skips an assignment with points_possible: null", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712333, "Ungraded note", null, "2026-10-12T03:59:00Z"),
      assignment(712332, "Project proposal", 100, "2026-10-19T03:59:00Z"),
    ]));
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 1, removed: 0 });
  });

  it("stores an assignment with due_at: null, kept and marked", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712334, "No deadline survey", 100, null),
    ]));
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 0, removed: 0 });
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
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 0, removed: 0 });
    expect(mockUpsert.mock.calls[0][0].update.assignmentGroupId).toBeNull();
  });

  it("puts Canvas's name into our title column", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712338, "Midterm exam", 100, "2026-10-26T03:59:00Z", 199452),
    ]));
    await importAssignments(CREDENTIALS, COURSE);
    expect(mockUpsert.mock.calls[0][0].update.title).toBe("Midterm exam");
  });

  it("converts Canvas's HTML description to capped plain text", async () => {
    vi.stubGlobal("fetch", singlePage([
      {
        ...assignment(712345, "Project proposal", 100, "2026-10-19T03:59:00Z"),
        description: "<p>Write  <b>two</b> pages &amp; cite&nbsp;sources.</p><script>alert(1)</script>",
      },
    ]));
    await importAssignments(CREDENTIALS, COURSE);
    expect(mockUpsert.mock.calls[0][0].update.description).toBe(
      "Write two pages & cite sources."
    );
    expect(mockUpsert.mock.calls[0][0].update.description).not.toContain("alert");
  });

  it("caps a huge description at 4000 characters", async () => {
    vi.stubGlobal("fetch", singlePage([
      {
        ...assignment(712346, "Long brief", 100, "2026-10-19T03:59:00Z"),
        description: "<p>" + "x".repeat(5000) + "</p>",
      },
    ]));
    await importAssignments(CREDENTIALS, COURSE);
    expect(mockUpsert.mock.calls[0][0].update.description).toBe("x".repeat(4000));
  });

  it("stores null when the description is absent or not a string", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712347, "No brief", 100, "2026-10-19T03:59:00Z"),
      { ...assignment(712348, "Odd brief", 100, "2026-10-19T03:59:00Z"), description: 5 },
    ]));
    await importAssignments(CREDENTIALS, COURSE);
    expect(mockUpsert.mock.calls[0][0].update.description).toBeNull();
    expect(mockUpsert.mock.calls[1][0].update.description).toBeNull();
  });

  it("consumes three mocked pages, requesting per_page=100", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([assignment(1, "A", 100, null)]), { status: 200, headers: { Link: linkHeader(2) } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([assignment(2, "B", 100, null)]), { status: 200, headers: { Link: linkHeader(3) } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([assignment(3, "C", 100, null)]), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 3, skipped: 0, removed: 0 });
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
    expect(first).toEqual({ imported: 2, skipped: 0, removed: 0 });
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
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 7, skipped: 1, removed: 0 });
    expect(mockUpsert).toHaveBeenCalledTimes(7);
    const kept = mockUpsert.mock.calls.map((c) => c[0].where.courseId_canvasId.canvasId);
    expect(kept).toEqual(["712334", "712332", "712340", "712341", "712342", "712343", "712344"]);
  });

  it("deletes an assignment a later complete listing no longer returns", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712332, "Project proposal", 100, "2026-10-19T03:59:00Z"),
    ]));
    mockDeleteMany.mockResolvedValue({ count: 1 });
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 0, removed: 1 });
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        courseId: "course-1",
        canvasId: { notIn: ["712332"] },
      },
    });
  });

  it("keeps skipped rows Canvas still returns, so a point-less listing is not mass-deleted", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712331, "Academic Engagement: Fall 2026", 0, "2026-10-12T03:59:00Z"),
    ]));
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 0, skipped: 1, removed: 0 });
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        courseId: "course-1",
        canvasId: { notIn: ["712331"] },
      },
    });
  });

  it("scopes removal to this course only", async () => {
    vi.stubGlobal("fetch", singlePage([
      assignment(712332, "Project proposal", 100, "2026-10-19T03:59:00Z"),
    ]));
    mockDeleteMany.mockResolvedValue({ count: 1 });
    await importAssignments(CREDENTIALS, COURSE);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { courseId: "course-1", canvasId: { notIn: ["712332"] } },
    });
  });

  it("deletes nothing when a page fetch fails part-way", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([assignment(1, "A", 100, null)]), { status: 200, headers: { Link: linkHeader(2) } }))
      .mockRejectedValueOnce(new Error("Canvas request failed before a response"));
    vi.stubGlobal("fetch", mockFetch);
    await expect(importAssignments(CREDENTIALS, COURSE)).rejects.toThrow(
      "Canvas request failed before a response"
    );
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("deletes on an empty listing when the course had few assignments", async () => {
    vi.stubGlobal("fetch", singlePage([]));
    mockCount.mockResolvedValue(3);
    mockDeleteMany.mockResolvedValue({ count: 3 });
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 0, skipped: 0, removed: 3 });
    expect(mockCount).toHaveBeenCalledWith({ where: { courseId: "course-1" } });
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: {
        courseId: "course-1",
      },
    });
  });

  it("skips the empty-listing deletion when 20 or more API assignments are stored, logging the fixed line", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", singlePage([]));
    mockCount.mockResolvedValue(20);
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 0, skipped: 0, removed: 0 });
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Canvas returned an empty assignment list; skipping assignment removal for this sync",
    );
  });

  it("logs and deletes nothing on an empty listing exactly at the 19-row boundary", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", singlePage([]));
    mockCount.mockResolvedValue(19);
    mockDeleteMany.mockResolvedValue({ count: 19 });
    await expect(importAssignments(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 0, skipped: 0, removed: 19 });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
  });
});
