import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignmentGroup: { upsert: mockUpsert },
  },
}));

import { importAssignmentGroups } from "./assignment-groups";
import type { Course } from "@/generated/prisma/client";

const BASE_URL = "https://canvas.example.edu";
const TOKEN = "canvas-token-123";
const PATH = "/api/v1/courses/67506/assignment_groups?per_page=100";

const COURSE = {
  id: "course-1",
  canvasId: "67506",
} as unknown as Course;

function group(
  id: number,
  name: string,
  groupWeight: number | undefined,
  position = 1
): Record<string, unknown> {
  const g: Record<string, unknown> = { id, name, position };
  if (groupWeight !== undefined) {
    g.group_weight = groupWeight;
  }
  return g;
}

function linkHeader(page: number): string {
  return `<${BASE_URL}/api/v1/courses/67506/assignment_groups?page=${page}&per_page=100>; rel="next"`;
}

describe("importAssignmentGroups", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores group_weight: 25 as 25", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify([group(199455, "Project", 25, 8)]), { status: 200 })
    ));
    await expect(importAssignmentGroups({ baseUrl: BASE_URL, token: TOKEN }, COURSE)).resolves.toEqual({
      imported: 1,
    });
    expect(mockUpsert.mock.calls[0][0].update).toEqual({
      name: "Project",
      groupWeight: 25,
      position: 8,
    });
  });

  it("stores an absent group_weight as null, not 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify([group(199455, "Project", undefined, 8)]), { status: 200 })
    ));
    await importAssignmentGroups({ baseUrl: BASE_URL, token: TOKEN }, COURSE);
    expect(mockUpsert.mock.calls[0][0].update.groupWeight).toBeNull();
  });

  it("stores group_weight: 0 as 0, not null (the distinction matters)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify([group(190823, "Academic Engagement: Fall 2026", 0, 1)]), { status: 200 })
    ));
    await importAssignmentGroups({ baseUrl: BASE_URL, token: TOKEN }, COURSE);
    expect(mockUpsert.mock.calls[0][0].update.groupWeight).toBe(0);
    expect(mockUpsert.mock.calls[0][0].update.groupWeight).not.toBeNull();
  });

  it("upserts on the compound courseId_canvasId shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify([group(190823, "Academic Engagement: Fall 2026", 0, 1)]), { status: 200 })
    ));
    await importAssignmentGroups({ baseUrl: BASE_URL, token: TOKEN }, COURSE);
    const args = mockUpsert.mock.calls[0][0] as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.where).toEqual({
      courseId_canvasId: { courseId: "course-1", canvasId: "190823" },
    });
    expect(args.create).toEqual({
      courseId: "course-1",
      canvasId: "190823",
      name: "Academic Engagement: Fall 2026",
      groupWeight: 0,
      position: 1,
    });
  });

  it("consumes two mocked pages, requesting per_page=100", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([group(190823, "Academic Engagement: Fall 2026", 0, 1), group(199451, "Labs", 5, 3)]),
          { status: 200, headers: { Link: linkHeader(2) } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([group(199452, "Midterm", 20, 4)]), { status: 200 })
      );
    vi.stubGlobal("fetch", mockFetch);
    await expect(importAssignmentGroups({ baseUrl: BASE_URL, token: TOKEN }, COURSE)).resolves.toEqual({
      imported: 3,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE_URL}${PATH}`);
    expect(mockFetch.mock.calls[1][0]).toBe(
      `${BASE_URL}/api/v1/courses/67506/assignment_groups?page=2&per_page=100`
    );
    const canvasIds = mockUpsert.mock.calls.map((c) => c[0].where.courseId_canvasId.canvasId);
    expect(canvasIds).toEqual(["190823", "199451", "199452"]);
  });
});
