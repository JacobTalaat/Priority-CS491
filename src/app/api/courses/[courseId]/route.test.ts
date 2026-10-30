import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAccessToken, mockUserFindUnique, mockCourseFindFirst } = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockCourseFindFirst: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    course: { findFirst: mockCourseFindFirst },
  },
}));

import { GET, dynamic } from "./route";

const COURSE_ROW = {
  id: "course-1",
  name: "Algorithms",
  courseCode: "CS-341",
  term: "Fall 2026",
  termEndsAt: new Date("2026-12-20T00:00:00.000Z"),
  gradeSetup: {
    classDetails: {
      instructor: "Professor Example",
      section: "002",
      credits: 3,
      officeHours: "Tue 2-4pm, GITC 4400",
      latePolicy: "10% off per day, max 3 days",
      contacts: "prof@njit.edu; TA ta@njit.edu",
    },
    confirmedAt: new Date("2026-10-11T18:30:00.000Z"),
  },
  assignments: [
    {
      id: "assignment-1",
      title: "Homework 1",
      dueAt: new Date("2026-09-10T03:59:00.000Z"),
      hasDueDate: true,
      pointsPossible: 10,
      htmlUrl: "https://canvas.example.edu/courses/1/assignments/1",
      assignmentGroup: { name: "Homework" },
      grade: { score: 9.5, gradedAt: new Date("2026-09-12T15:00:00.000Z") },
    },
    {
      id: "assignment-2",
      title: "Project 1",
      dueAt: null,
      hasDueDate: false,
      pointsPossible: 20,
      htmlUrl: null,
      assignmentGroup: null,
      grade: null,
    },
  ],
};

const EXPECTED_SELECT = {
  id: true,
  name: true,
  courseCode: true,
  term: true,
  termEndsAt: true,
  gradeSetup: { select: { classDetails: true, confirmedAt: true } },
  assignments: {
    select: {
      id: true,
      title: true,
      dueAt: true,
      hasDueDate: true,
      pointsPossible: true,
      htmlUrl: true,
      assignmentGroup: { select: { name: true } },
      grade: { select: { score: true, gradedAt: true } },
    },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { title: "asc" }, { id: "asc" }],
  },
};

function request(withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer session-token");
  }
  return new Request("http://localhost/api/courses/course-1", { headers });
}

function authUserRow() {
  return { id: "user-1", email: "student@example.com" };
}

const context = { params: Promise.resolve({ courseId: "course-1" }) };

describe("GET /api/courses/[courseId]", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset().mockResolvedValue({
      authUserId: "auth-user-1",
      email: "student@example.com",
    });
    mockUserFindUnique.mockReset().mockResolvedValue(authUserRow());
    mockCourseFindFirst.mockReset().mockResolvedValue(COURSE_ROW);
  });

  it("returns the course, the saved class details, and the assignments with one query", async () => {
    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      course: {
        id: "course-1",
        name: "Algorithms",
        courseCode: "CS-341",
        term: "Fall 2026",
        termEndsAt: "2026-12-20T00:00:00.000Z",
      },
      details: {
        instructor: "Professor Example",
        section: "002",
        credits: 3,
        officeHours: "Tue 2-4pm, GITC 4400",
        latePolicy: "10% off per day, max 3 days",
        contacts: "prof@njit.edu; TA ta@njit.edu",
        confirmedAt: "2026-10-11T18:30:00.000Z",
      },
      assignments: [
        {
          id: "assignment-1",
          title: "Homework 1",
          dueAt: "2026-09-10T03:59:00.000Z",
          hasDueDate: true,
          pointsPossible: 10,
          htmlUrl: "https://canvas.example.edu/courses/1/assignments/1",
          assignmentGroup: { name: "Homework" },
          grade: { score: 9.5, gradedAt: "2026-09-12T15:00:00.000Z" },
        },
        {
          id: "assignment-2",
          title: "Project 1",
          dueAt: null,
          hasDueDate: false,
          pointsPossible: 20,
          htmlUrl: null,
          assignmentGroup: null,
          grade: null,
        },
      ],
    });
    expect(mockCourseFindFirst).toHaveBeenCalledTimes(1);
    expect(mockCourseFindFirst).toHaveBeenCalledWith({
      where: { id: "course-1", userId: "user-1", isCurrent: true },
      select: EXPECTED_SELECT,
    });
  });

  it("returns null for the class details the weights form does not save", async () => {
    mockCourseFindFirst.mockResolvedValue({
      ...COURSE_ROW,
      gradeSetup: {
        classDetails: { instructor: "Professor Example", section: "002", credits: 3 },
        confirmedAt: new Date("2026-10-11T18:30:00.000Z"),
      },
    });
    const response = await GET(request(), context);
    const body = await response.json();

    expect(body.details).toEqual({
      instructor: "Professor Example",
      section: "002",
      credits: 3,
      officeHours: null,
      latePolicy: null,
      contacts: null,
      confirmedAt: "2026-10-11T18:30:00.000Z",
    });
  });

  it("returns null for every details value when no setup is saved", async () => {
    mockCourseFindFirst.mockResolvedValue({ ...COURSE_ROW, gradeSetup: null });
    const response = await GET(request(), context);
    const body = await response.json();

    expect(body.details).toEqual({
      instructor: null,
      section: null,
      credits: null,
      officeHours: null,
      latePolicy: null,
      contacts: null,
      confirmedAt: null,
    });
  });

  it("returns null for details saved with the wrong type", async () => {
    mockCourseFindFirst.mockResolvedValue({
      ...COURSE_ROW,
      gradeSetup: {
        classDetails: { instructor: "Professor Example", officeHours: 5, credits: "3" },
        confirmedAt: new Date("2026-10-11T18:30:00.000Z"),
      },
    });
    const response = await GET(request(), context);
    const body = await response.json();

    expect(body.details).toEqual({
      instructor: "Professor Example",
      section: null,
      credits: null,
      officeHours: null,
      latePolicy: null,
      contacts: null,
      confirmedAt: "2026-10-11T18:30:00.000Z",
    });
  });

  it("returns grade null for work handed in but not graded yet", async () => {
    mockCourseFindFirst.mockResolvedValue({
      ...COURSE_ROW,
      assignments: [{ ...COURSE_ROW.assignments[0], grade: { score: null, gradedAt: null } }],
    });
    const response = await GET(request(), context);
    const body = await response.json();

    expect(body.assignments[0].grade).toBeNull();
  });

  it("does not return another user's or a non-current course", async () => {
    mockCourseFindFirst.mockResolvedValue(null);
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Current course not found." });
  });

  it("requires an app session", async () => {
    const response = await GET(request(false), context);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockCourseFindFirst).not.toHaveBeenCalled();
  });

  it("opts out of caching", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
