import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSessionFindUnique, mockUserFindUnique, mockCourseFindMany } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockCourseFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    user: { findUnique: mockUserFindUnique },
    course: { findMany: mockCourseFindMany },
  },
}));

import { GET } from "./route";

function request(withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer app-token");
  }
  return new Request("http://localhost/api/canvas/courses", { headers });
}

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

describe("GET /api/canvas/courses", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
    mockUserFindUnique.mockReset();
    mockCourseFindMany.mockReset();
  });

  it("returns only current-term courses belonging to the authenticated user", async () => {
    const courses = [
      { id: "course-1", name: "Algorithms", courseCode: "CS-341", term: "Fall 2026", termEndsAt: null },
    ];
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockResolvedValue({
      canvasTokenCipher: "cipher",
      canvasTokenIv: "iv",
      canvasTokenTag: "tag",
      canvasBaseUrl: "https://canvas.example.edu",
    });
    mockCourseFindMany.mockResolvedValue(courses);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connected: true, courses });
    expect(mockCourseFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", isCurrent: true },
      select: { id: true, name: true, courseCode: true, term: true, termEndsAt: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  });

  it("returns no courses when Canvas is not connected", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connected: false, courses: [] });
    expect(mockCourseFindMany).not.toHaveBeenCalled();
  });

  it("rejects requests without an app session", async () => {
    const response = await GET(request(false));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockCourseFindMany).not.toHaveBeenCalled();
  });
});
