import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockFindMany } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    grade: { upsert: mockUpsert },
    assignment: { findMany: mockFindMany },
  },
}));

import { importGrades } from "./grades";
import type { Course } from "@/generated/prisma/client";

const BASE_URL = "https://canvas.example.edu";
const TOKEN = "canvas-token-123";
const PATH = "/api/v1/courses/67506/students/submissions?student_ids[]=self&per_page=100";

const COURSE = {
  id: "course-1",
  canvasId: "67506",
} as unknown as Course;

const CREDENTIALS = { baseUrl: BASE_URL, token: TOKEN };

const STORED_ASSIGNMENTS = [
  { id: "assignment-local-1", canvasId: "736750" },
  { id: "assignment-local-2", canvasId: "736751" },
  { id: "assignment-local-3", canvasId: "736752" },
  { id: "assignment-local-4", canvasId: "736761" },
];

function submission(
  assignmentId: number,
  score: number | null,
  workflowState: string,
  gradedAt: string | null,
  excused: boolean | null = null
): Record<string, unknown> {
  return {
    assignment_id: assignmentId,
    score,
    workflow_state: workflowState,
    graded_at: gradedAt,
    excused,
  };
}

function linkHeader(page: number): string {
  return `<${BASE_URL}/api/v1/courses/67506/students/submissions?page=${page}&per_page=100&student_ids[]=self>; rel="next"`;
}

function singlePage(items: Record<string, unknown>[]) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(items), { status: 200 }));
}

describe("importGrades", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue(STORED_ASSIGNMENTS);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores a graded submission with a numeric score, with gradedAt parsed", async () => {
    vi.stubGlobal("fetch", singlePage([
      submission(736750, 103, "graded", "2026-09-26T23:09:43Z", false),
    ]));
    await importGrades(CREDENTIALS, COURSE);
    expect(mockUpsert.mock.calls[0][0].update).toMatchObject({
      score: 103,
      gradedAt: new Date("2026-09-26T23:09:43Z"),
    });
  });

  it("skips workflow_state: unsubmitted", async () => {
    vi.stubGlobal("fetch", singlePage([
      submission(736750, null, "unsubmitted", null),
    ]));
    await expect(importGrades(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 0, skipped: 1 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("skips workflow_state: graded with score: null", async () => {
    vi.stubGlobal("fetch", singlePage([
      submission(736750, null, "graded", null),
    ]));
    await expect(importGrades(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 0, skipped: 1 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("skips excused: true even with a score, using a strict check so excused: null passes", async () => {
    vi.stubGlobal("fetch", singlePage([
      submission(736750, 50, "graded", "2026-09-26T23:09:43Z", true),
      submission(736751, 100, "graded", "2026-10-05T02:56:36Z", null),
    ]));
    await expect(importGrades(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 1 });
    expect(mockUpsert.mock.calls[0][0].where).toEqual({ assignmentId: "assignment-local-2" });
  });

  it("skips an unknown assignment_id, the 0-point assignment PR-010 filtered out, without throwing", async () => {
    vi.stubGlobal("fetch", singlePage([
      submission(712331, null, "submitted", null),
      submission(736750, 103, "graded", "2026-09-26T23:09:43Z", false),
    ]));
    await expect(importGrades(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 1, skipped: 1 });
    const localIds = mockUpsert.mock.calls.map((c) => c[0].where.assignmentId);
    expect(localIds).toEqual(["assignment-local-1"]);
  });

  it("upserts where the local assignment id is, from the Canvas assignment_id map", async () => {
    vi.stubGlobal("fetch", singlePage([
      submission(736761, 93.75, "graded", "2026-09-17T15:39:44Z", false),
    ]));
    await importGrades(CREDENTIALS, COURSE);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { courseId: "course-1" },
      select: { id: true, canvasId: true },
    });
    expect(mockUpsert.mock.calls[0][0].where).toEqual({ assignmentId: "assignment-local-4" });
    expect(mockUpsert.mock.calls[0][0].create).toEqual({
      assignmentId: "assignment-local-4",
      score: 93.75,
      gradedAt: new Date("2026-09-17T15:39:44Z"),
    });
  });

  it("re-import with a changed score issues the same where with an update carrying the new score", async () => {
    vi.stubGlobal("fetch", singlePage([
      submission(736750, 103, "graded", "2026-09-26T23:09:43Z", false),
    ]));
    await importGrades(CREDENTIALS, COURSE);
    const firstCalls = [...mockUpsert.mock.calls];
    vi.stubGlobal("fetch", singlePage([
      submission(736750, 95, "graded", "2026-09-26T23:09:43Z", false),
    ]));
    await importGrades(CREDENTIALS, COURSE);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert.mock.calls[1][0].where).toEqual(firstCalls[0][0].where);
    expect(mockUpsert.mock.calls[1][0].where).toEqual({ assignmentId: "assignment-local-1" });
    expect(mockUpsert.mock.calls[1][0].update).toMatchObject({ score: 95 });
  });

  it("consumes two mocked pages, requesting per_page=100", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([submission(736750, 103, "graded", "2026-09-26T23:09:43Z", false)]), { status: 200, headers: { Link: linkHeader(2) } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([submission(736751, 100, "graded", "2026-10-05T02:56:36Z", false)]), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    await expect(importGrades(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 2, skipped: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE_URL}${PATH}`);
    expect(mockFetch.mock.calls[1][0]).toBe(`${BASE_URL}/api/v1/courses/67506/students/submissions?page=2&per_page=100&student_ids[]=self`);
  });

  it("stores a score above the assignment's points without clamping, extra credit", async () => {
    vi.stubGlobal("fetch", singlePage([
      submission(736750, 103, "graded", "2026-09-26T23:09:43Z", false),
    ]));
    await importGrades(CREDENTIALS, COURSE);
    expect(mockUpsert.mock.calls[0][0].update.score).toBe(103);
  });

  it("matches the real-course fixture: 3 stored, 2 skipped", async () => {
    const items = [
      submission(712331, null, "submitted", null),
      submission(736750, 103.0, "graded", "2026-09-26T23:09:43Z", false),
      submission(736751, 100.0, "graded", "2026-10-05T02:56:36Z", false),
      submission(736752, null, "submitted", null),
      submission(736761, 93.75, "graded", "2026-09-17T15:39:44Z", false),
    ];
    vi.stubGlobal("fetch", singlePage(items));
    await expect(importGrades(CREDENTIALS, COURSE)).resolves.toEqual({ imported: 3, skipped: 2 });
    expect(mockUpsert).toHaveBeenCalledTimes(3);
    const localIds = mockUpsert.mock.calls.map((c) => c[0].where.assignmentId);
    expect(localIds).toEqual(["assignment-local-1", "assignment-local-2", "assignment-local-4"]);
    expect(mockUpsert.mock.calls[2][0].update).toMatchObject({ score: 93.75 });
  });
});
