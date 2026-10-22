import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSessionFindUnique,
  mockAssignmentFindFirst,
  mockPlanAssignment,
} = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockAssignmentFindFirst: vi.fn(),
  mockPlanAssignment: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    assignment: { findFirst: mockAssignmentFindFirst },
  },
}));

vi.mock("@/lib/plan-steps", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan-steps")>();
  return { ...actual, planAssignment: mockPlanAssignment };
});

import { POST } from "./route";

const ASSIGNMENT_ROW = {
  title: "Project proposal",
  description: "Write two pages on your topic and cite sources.",
  dueAt: new Date("2026-10-19T03:59:00Z"),
  hasDueDate: true,
  pointsPossible: 100,
};

const STEPS = [
  { title: "Skim the brief", minutes: 15 },
  { title: "Draft the outline", minutes: 45 },
  { title: "Review and submit", minutes: 20 },
];

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

function request(body?: unknown, withSession = true): Request {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer session-token");
  }
  return new Request("http://localhost/api/assignments/assignment-1/plan", {
    method: "POST",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function rawRequest(rawBody: string, withSession = true): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (withSession) {
    headers.set("Authorization", "Bearer session-token");
  }
  return new Request("http://localhost/api/assignments/assignment-1/plan", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

const context = { params: Promise.resolve({ assignmentId: "assignment-1" }) };

describe("POST /api/assignments/[assignmentId]/plan", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockAssignmentFindFirst.mockReset().mockResolvedValue(ASSIGNMENT_ROW);
    mockPlanAssignment.mockReset().mockResolvedValue({ ok: true, steps: STEPS });
  });

  it("plans the authenticated student's assignment found through a current course", async () => {
    const response = await POST(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockAssignmentFindFirst).toHaveBeenCalledWith({
      where: { id: "assignment-1", course: { userId: "user-1", isCurrent: true } },
      select: {
        title: true,
        description: true,
        dueAt: true,
        hasDueDate: true,
        pointsPossible: true,
      },
    });
    expect(mockPlanAssignment).toHaveBeenCalledWith(
      {
        title: "Project proposal",
        description: "Write two pages on your topic and cite sources.",
        dueAt: new Date("2026-10-19T03:59:00Z"),
        hasDueDate: true,
        pointsPossible: 100,
        hoursAvailable: null,
      },
      "user-1"
    );
    expect(body).toEqual({ steps: STEPS, totalMinutes: 80 });
  });

  it("passes tonight's hours through to the planner", async () => {
    await POST(request({ hoursAvailable: 2 }), context);
    expect(mockPlanAssignment.mock.calls[0][0].hoursAvailable).toBe(2);
  });

  it("accepts an empty JSON object and a body-less request", async () => {
    for (const req of [request({}), request()]) {
      const response = await POST(req, context);
      expect(response.status).toBe(200);
      expect(mockPlanAssignment.mock.calls.at(-1)![0].hoursAvailable).toBeNull();
    }
  });

  it("rejects a non-object body and invalid JSON", async () => {
    const arrayResponse = await POST(request([1, 2]), context);
    expect(arrayResponse.status).toBe(400);
    await expect(arrayResponse.json()).resolves.toEqual({ error: "Invalid JSON body." });

    const badJson = await POST(rawRequest("{not-json"), context);
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toEqual({ error: "Invalid JSON body." });

    expect(mockAssignmentFindFirst).not.toHaveBeenCalled();
    expect(mockPlanAssignment).not.toHaveBeenCalled();
  });

  it("rejects hoursAvailable that are not numbers or outside 0.5 to 12", async () => {
    for (const hoursAvailable of [0, 0.25, -1, 12.5, "2", null, true]) {
      const response = await POST(request({ hoursAvailable }), context);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Send hoursAvailable as a number of hours between 0.5 and 12.",
      });
    }
    expect(mockAssignmentFindFirst).not.toHaveBeenCalled();
    expect(mockPlanAssignment).not.toHaveBeenCalled();
  });

  it("accepts the hours bounds 0.5 and 12", async () => {
    await POST(request({ hoursAvailable: 0.5 }), context);
    expect(mockAssignmentFindFirst).toHaveBeenCalledTimes(1);
    expect(mockPlanAssignment.mock.calls[0][0].hoursAvailable).toBe(0.5);

    await POST(request({ hoursAvailable: 12 }), context);
    expect(mockPlanAssignment.mock.calls[1][0].hoursAvailable).toBe(12);
  });

  it("returns 404 for an assignment outside the student's current courses", async () => {
    mockAssignmentFindFirst.mockResolvedValue(null);
    const response = await POST(request(), context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Assignment not found." });
    expect(mockPlanAssignment).not.toHaveBeenCalled();
  });

  it("requires an app session", async () => {
    const response = await POST(request(undefined, false), context);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockAssignmentFindFirst).not.toHaveBeenCalled();
    expect(mockPlanAssignment).not.toHaveBeenCalled();
  });

  it("maps a used-up AI budget to 503 with a plain message", async () => {
    mockPlanAssignment.mockResolvedValue({
      ok: false,
      error:
        "Priority's AI budget for this month is used up, so it couldn't plan this assignment. Try again next month.",
      capReached: true,
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error:
        "Priority's AI budget for this month is used up, so it couldn't plan this assignment. Try again next month.",
    });
  });

  it("maps other AI failures to 502 with a generic message", async () => {
    mockPlanAssignment.mockResolvedValue({
      ok: false,
      error: "Priority couldn't turn this assignment into steps right now. Try again in a little while.",
      capReached: false,
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Priority couldn't turn this assignment into steps right now. Try again in a little while.",
    });
  });

  it("forces dynamic rendering", async () => {
    const { dynamic } = await import("./route");
    expect(dynamic).toBe("force-dynamic");
  });
});
