import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({
  getToken: () => "session-token",
}));

import { saveManualGrade } from "./course-client";

describe("saveManualGrade", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the assignment ID and score to the course manual-grades route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          grade: {
            score: 18,
            gradedAt: "2026-10-20T12:00:00.000Z",
            isManual: true,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveManualGrade("course 1", "assignment-1", 18);

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        grade: {
          score: 18,
          gradedAt: "2026-10-20T12:00:00.000Z",
          isManual: true,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/courses/course%201/grades",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ assignmentId: "assignment-1", score: 18 }),
      }),
    );
  });
});
