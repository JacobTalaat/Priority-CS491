import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindMany, mockUpsert } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: { findMany: mockFindMany },
    assignment: { upsert: mockUpsert },
  },
}));

import { importCalendarAssignments } from "./calendar-assignments";

const SOURCE = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:assignment_987@example.instructure.com
DTSTART:20261014T193000Z
SUMMARY:Read chapter 4
URL:https://canvas.example.edu/courses/123/assignments/987
END:VEVENT
END:VCALENDAR`;

describe("importCalendarAssignments", () => {
  beforeEach(() => {
    mockFindMany.mockReset().mockResolvedValue([
      { id: "course-row-1", canvasId: "123" },
      { id: "course-row-2", canvasId: "456" },
    ]);
    mockUpsert.mockReset().mockResolvedValue({});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(SOURCE, { status: 200, headers: { "Content-Type": "text/calendar" } }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("upserts the event as a dated assignment in its course", async () => {
    await expect(
      importCalendarAssignments("user-1", "https://canvas.example.edu/feed.ics"),
    ).resolves.toEqual({ imported: 1, skipped: 0, courses: 2 });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", isCurrent: true },
      select: { id: true, canvasId: true },
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { courseId_canvasId: { courseId: "course-row-1", canvasId: "987" } },
      create: {
        courseId: "course-row-1",
        canvasId: "987",
        title: "Read chapter 4",
        dueAt: new Date("2026-10-14T19:30:00.000Z"),
        hasDueDate: true,
        pointsPossible: 0,
        htmlUrl: "https://canvas.example.edu/courses/123/assignments/987",
        assignmentGroupId: null,
      },
      update: {
        title: "Read chapter 4",
        dueAt: new Date("2026-10-14T19:30:00.000Z"),
        hasDueDate: true,
        pointsPossible: 0,
        htmlUrl: "https://canvas.example.edu/courses/123/assignments/987",
        assignmentGroupId: null,
      },
    });
  });

  it("skips events for courses outside the current user's imported courses", async () => {
    const source = SOURCE.replace("/courses/123/", "/courses/999/");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(source, { status: 200 })));
    await expect(
      importCalendarAssignments("user-1", "https://canvas.example.edu/feed.ics"),
    ).resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
