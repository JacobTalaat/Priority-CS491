import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockUpdateMany, mockGetCanvasToken } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockGetCanvasToken: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: { upsert: mockUpsert, updateMany: mockUpdateMany },
  },
}));

vi.mock("@/lib/canvas-credentials", () => ({
  getCanvasToken: mockGetCanvasToken,
}));

import { importCourses } from "./courses";

const BASE_URL = "https://canvas.example.edu";
const TOKEN = "canvas-token-123";
const USER_ID = "user-1";
const CLOCKS_AT = "2026-10-07T12:00:00Z";

const TERMS = [
  { id: 44, name: "Community Courses", start_at: null, end_at: null, courseCount: 4 },
  { id: 1, name: "Default Term", start_at: null, end_at: null, courseCount: 1 },
  { id: 7, name: "Tutorials", start_at: "2019-02-01T05:00:00Z", end_at: null, courseCount: 1 },
  { id: 270, name: "Fall 2024", start_at: "2024-08-20T04:00:00Z", end_at: "2026-12-26T04:59:00Z", courseCount: 6 },
  { id: 273, name: "Spring 2025", start_at: "2025-01-07T05:00:00Z", end_at: "2027-05-18T04:00:00Z", courseCount: 7 },
  { id: 274, name: "Summer 2025", start_at: "2025-05-13T04:00:00Z", end_at: "2027-08-12T03:59:00Z", courseCount: 3 },
  { id: 275, name: "Fall 2025", start_at: "2025-08-19T04:00:00Z", end_at: "2027-12-23T04:59:00Z", courseCount: 6 },
  { id: 278, name: "Spring 2026", start_at: "2026-01-04T05:00:00Z", end_at: "2028-05-20T03:59:00Z", courseCount: 4 },
  { id: 279, name: "Summer 2026", start_at: "2026-05-12T04:00:00Z", end_at: "2028-08-14T03:59:00Z", courseCount: 5 },
  { id: 380, name: "Fall 2026", start_at: "2026-08-18T04:00:00Z", end_at: "2028-12-22T05:00:00Z", courseCount: 4 },
] as const;

function course(id: number, name: string, termId: number) {
  const term = TERMS.find((t) => t.id === termId)!;
  return {
    id,
    name,
    course_code: `CS-${id}`,
    term: { id: term.id, name: term.name, start_at: term.start_at, end_at: term.end_at },
  };
}

function realAccountCourses() {
  const courses: ReturnType<typeof course>[] = [];
  let id = 1000;
  for (const t of TERMS) {
    for (let i = 0; i < t.courseCount; i += 1) {
      courses.push(course(id, `${t.name} course ${i + 1}`, t.id));
      id += 1;
    }
  }
  return courses;
}

function singlePage(courses: unknown[]) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(courses), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

describe("importCourses", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockImplementation(({ create }) => ({ id: `local-${create.canvasId}` }));
    mockUpdateMany.mockReset().mockResolvedValue({ count: 0 });
    mockGetCanvasToken.mockReset();
    mockGetCanvasToken.mockResolvedValue({ baseUrl: BASE_URL, token: TOKEN });
    vi.setSystemTime(new Date(CLOCKS_AT));
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("imports only the term with the greatest start_at (the real account fixture)", async () => {
    const mockFetch = singlePage(realAccountCourses());
    vi.stubGlobal("fetch", mockFetch);
    await expect(importCourses(USER_ID)).resolves.toMatchObject({ imported: 4, skipped: 37 });
    expect(mockUpsert).toHaveBeenCalledTimes(4);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(
      `${BASE_URL}/api/v1/courses?enrollment_state=active&include[]=term&per_page=100`
    );
    for (const call of mockUpsert.mock.calls) {
      const args = call[0] as { where: { userId_canvasId: { userId: string; canvasId: string } } };
      expect(args.where.userId_canvasId.userId).toBe(USER_ID);
      expect(Number(args.where.userId_canvasId.canvasId)).toBeGreaterThanOrEqual(1029);
    }
  });

  it("skips a term whose start_at is two years old even though its end_at is still in the future", async () => {
    const mockFetch = singlePage([
      course(1, "Old but unexpired", 270),
      course(2, "Current", 380),
    ]);
    vi.stubGlobal("fetch", mockFetch);
    await expect(importCourses(USER_ID)).resolves.toMatchObject({ imported: 1, skipped: 1 });
    const canvasIds = mockUpsert.mock.calls.map((c) => c[0].where.userId_canvasId.canvasId);
    expect(canvasIds).toEqual(["2"]);
  });

  it("skips courses whose term has a null start_at", async () => {
    vi.stubGlobal("fetch", singlePage([
      course(1, "Community A", 44),
      course(2, "Community B", 44),
    ]));
    await expect(importCourses(USER_ID)).resolves.toMatchObject({ imported: 0, skipped: 2 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns courseIds for only the current term, so sync cannot process stale terms", async () => {
    vi.stubGlobal("fetch", singlePage(realAccountCourses()));
    const result = await importCourses(USER_ID);
    expect(result.courseIds).toHaveLength(4);
    const upsertedIds = mockUpsert.mock.calls.map((c) => c[0].where.userId_canvasId.canvasId);
    expect(result.courseIds).toEqual(upsertedIds.map((id: string) => `local-${id}`));
  });

  it("does not treat a future term as current", async () => {
    const nextTerm = { id: 381, name: "Spring 2027", start_at: "2027-01-20T05:00:00Z", end_at: null };
    vi.stubGlobal("fetch", singlePage([
      course(1, "Current", 380),
      { id: 2, name: "Next semester", course_code: "CS-2", term: nextTerm },
    ]));
    const result = await importCourses(USER_ID);
    expect(result).toMatchObject({ imported: 1, skipped: 1 });
    const canvasIds = mockUpsert.mock.calls.map((c) => c[0].where.userId_canvasId.canvasId);
    expect(canvasIds).toEqual(["1"]);
  });

  it("imports nothing when no term has started", async () => {
    const spring2027 = { id: 381, name: "Spring 2027", start_at: "2027-01-20T05:00:00Z", end_at: null };
    vi.stubGlobal("fetch", singlePage([
      { id: 1, name: "Enrolled early", course_code: "CS-1", term: spring2027 },
    ]));
    await expect(importCourses(USER_ID)).resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("skips malformed courses with no id or no name", async () => {
    vi.stubGlobal("fetch", singlePage([
      course(1, "Good course", 380),
      { id: 2, course_code: "CS-2", term: TERMS[9] },
      { name: "No id", course_code: "CS-3", term: TERMS[9] },
    ]));
    await expect(importCourses(USER_ID)).resolves.toMatchObject({ imported: 1, skipped: 2 });
  });

  it("upserts on the compound userId_canvasId shape", async () => {
    vi.stubGlobal("fetch", singlePage([course(42, "Intro", 380)]));
    await importCourses(USER_ID);
    const args = mockUpsert.mock.calls[0][0] as {
      where: { userId_canvasId: { userId: string; canvasId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.where).toEqual({ userId_canvasId: { userId: USER_ID, canvasId: "42" } });
    expect(args.create).toEqual({
      userId: USER_ID,
      canvasId: "42",
      name: "Intro",
      courseCode: "CS-42",
      term: "Fall 2026",
      termEndsAt: new Date("2028-12-22T05:00:00Z"),
      isCurrent: true,
    });
    expect(args.update).toEqual({
      name: "Intro",
      courseCode: "CS-42",
      term: "Fall 2026",
      termEndsAt: new Date("2028-12-22T05:00:00Z"),
      isCurrent: true,
    });
  });

  it("running twice issues identical upserts and creates no second row", async () => {
    vi.stubGlobal("fetch", singlePage([course(42, "Intro", 380)]));
    const first = await importCourses(USER_ID);
    const whereFirst = mockUpsert.mock.calls[0][0].where;
    vi.stubGlobal("fetch", singlePage([course(42, "Intro", 380)]));
    const second = await importCourses(USER_ID);
    expect(first).toEqual(second);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert.mock.calls[1][0].where).toEqual(whereFirst);
  });

  it("throws the not-connected error and makes no HTTP request when unconnected", async () => {
    mockGetCanvasToken.mockResolvedValue(null);
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    await expect(importCourses(USER_ID)).rejects.toThrow("Canvas not connected");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("stores canvasId as a string even though Canvas sends a number", async () => {
    vi.stubGlobal("fetch", singlePage([course(42, "Intro", 380)]));
    await importCourses(USER_ID);
    const canvasId = mockUpsert.mock.calls[0][0].where.userId_canvasId.canvasId;
    expect(typeof canvasId).toBe("string");
  });

  it("clears the current marker from older courses after a successful import", async () => {
    vi.stubGlobal("fetch", singlePage([course(42, "Intro", 380)]));
    await importCourses(USER_ID);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { notIn: ["local-42"] } },
      data: { isCurrent: false },
    });
  });

  it("clears all current markers when Canvas has no current-term courses", async () => {
    vi.stubGlobal("fetch", singlePage([]));
    await importCourses(USER_ID);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { isCurrent: false },
    });
  });
});
