import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSessionFindUnique,
  mockAssignmentFindFirst,
  mockTransaction,
  mockExecuteRaw,
  mockStateFindUnique,
  mockStateUpsert,
  mockStateDeleteMany,
  mockEventFindUnique,
  mockEventCreate,
  mockLoadOpenWork,
} = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockAssignmentFindFirst: vi.fn(),
  mockTransaction: vi.fn(),
  mockExecuteRaw: vi.fn(),
  mockStateFindUnique: vi.fn(),
  mockStateUpsert: vi.fn(),
  mockStateDeleteMany: vi.fn(),
  mockEventFindUnique: vi.fn(),
  mockEventCreate: vi.fn(),
  mockLoadOpenWork: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    assignment: { findFirst: mockAssignmentFindFirst },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/ranking-data", () => ({
  loadOpenWork: mockLoadOpenWork,
}));

import { POST, dynamic } from "./route";

const ASSIGNMENT_ROW = { id: "assignment-1", courseId: "course-1", canvasId: "canvas-1" };

// The transaction mock journals every read and write the route makes inside a
// transaction and only commits the journal when the transaction callback
// resolves, so a test can tell what was attempted from what survived.
type Journal = {
  locks: unknown[];
  eventReads: unknown[];
  stateReads: unknown[];
  stateUpserts: unknown[];
  stateDeletes: unknown[];
  events: unknown[];
};

const freshJournal = (): Journal => ({
  locks: [],
  eventReads: [],
  stateReads: [],
  stateUpserts: [],
  stateDeletes: [],
  events: [],
});

let attempt: Journal = freshJournal();
let committed: Journal = freshJournal();

function sessionRow(userId = "user-1") {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: userId, email: "student@example.com" },
  };
}

// 12:30 PM EDT on Wednesday 2026-10-14, so the New York day is unambiguous.
const NOW = new Date("2026-10-14T16:30:00.000Z");

describe("POST /api/today/items/[assignmentId]/skip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    attempt = freshJournal();
    committed = freshJournal();

    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockAssignmentFindFirst.mockReset().mockResolvedValue(ASSIGNMENT_ROW);
    mockLoadOpenWork.mockReset().mockResolvedValue([{ assignmentId: "assignment-1" }]);

    const tx = {
      $executeRaw: mockExecuteRaw,
      itemState: {
        findUnique: mockStateFindUnique,
        upsert: mockStateUpsert,
        deleteMany: mockStateDeleteMany,
      },
      itemEvent: {
        findUnique: mockEventFindUnique,
        create: mockEventCreate,
      },
    };
    mockTransaction.mockReset().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      attempt = freshJournal();
      const result = await fn(tx);
      committed = attempt;
      return result;
    });
    mockExecuteRaw.mockReset().mockImplementation(async (...args: unknown[]) => {
      attempt.locks.push(args);
      return [];
    });
    mockStateFindUnique.mockReset().mockImplementation(async (args: unknown) => {
      attempt.stateReads.push(args);
      return null;
    });
    mockStateUpsert.mockReset().mockImplementation(async (args: unknown) => {
      attempt.stateUpserts.push(args);
      return {};
    });
    mockStateDeleteMany.mockReset().mockImplementation(async (args: unknown) => {
      attempt.stateDeletes.push(args);
      return { count: 0 };
    });
    mockEventFindUnique.mockReset().mockImplementation(async (args: unknown) => {
      attempt.eventReads.push(args);
      return null;
    });
    mockEventCreate.mockReset().mockImplementation(async (args: unknown) => {
      attempt.events.push(args);
      return { id: "event-1" };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function post({ withSession = true, body, client, requestId }: { withSession?: boolean; body?: unknown; client?: string; requestId?: string } = {}) {
    const headers = new Headers();
    if (withSession) {
      headers.set("Authorization", "Bearer session-token");
    }
    if (client) {
      headers.set("X-Priority-Client", client);
    }
    if (requestId) {
      headers.set("X-Priority-Request-Id", requestId);
    }
    return new Request("http://localhost/api/today/items/assignment-1/skip", {
      method: "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  const context = { params: Promise.resolve({ assignmentId: "assignment-1" }) };

  it("requires an app session", async () => {
    const response = await POST(post({ withSession: false }), context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockAssignmentFindFirst).not.toHaveBeenCalled();
    expect(mockLoadOpenWork).not.toHaveBeenCalled();
    expect(committed.events).toHaveLength(0);
  });

  it("stores skipped for today's New York day and writes exactly one event", async () => {
    const response = await POST(post(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ assignmentId: "assignment-1", status: "skipped" });
    expect(mockAssignmentFindFirst).toHaveBeenCalledTimes(1);
    expect(mockAssignmentFindFirst).toHaveBeenCalledWith({
      where: { id: "assignment-1", course: { userId: "user-1", isCurrent: true } },
      select: { id: true, courseId: true, canvasId: true },
    });
    expect(mockLoadOpenWork).toHaveBeenCalledTimes(1);
    expect(committed.stateUpserts).toHaveLength(1);
    expect(committed.stateUpserts[0]).toEqual({
      where: { userId_assignmentId: { userId: "user-1", assignmentId: "assignment-1" } },
      update: { status: "skipped", skippedDay: "2026-10-14" },
      create: { userId: "user-1", assignmentId: "assignment-1", status: "skipped", skippedDay: "2026-10-14" },
    });
    expect(committed.events).toHaveLength(1);
    expect(committed.events[0]).toEqual({
      data: {
        userId: "user-1",
        assignmentId: "assignment-1",
        courseId: "course-1",
        assignmentCanvasId: "canvas-1",
        action: "skip",
        client: "unknown",
        requestId: null,
        shownRank: null,
        listGeneratedAt: null,
        serverRank: 1,
        response: { assignmentId: "assignment-1", status: "skipped" },
      },
    });
  });

  it("uses the New York day, not the UTC day", async () => {
    // 2026-10-15T03:00Z is 2026-10-14 23:00 in New York (EDT is UTC-4), so the
    // skip lands on "2026-10-14" even though UTC already reads Oct 15.
    vi.setSystemTime(new Date("2026-10-15T03:00:00.000Z"));
    // The clock jump expired the session created at the earlier fake time.
    mockSessionFindUnique.mockResolvedValue(sessionRow());

    await POST(post(), context);

    const upsert = committed.stateUpserts[0] as { update: { skippedDay: string } };
    expect(upsert.update.skippedDay).toBe("2026-10-14");
  });

  it("leaves a done state untouched but still logs the skip", async () => {
    mockStateFindUnique.mockImplementation(async (args: unknown) => {
      attempt.stateReads.push(args);
      return { status: "done" };
    });

    const response = await POST(post(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ assignmentId: "assignment-1", status: "done" });
    expect(committed.stateReads).toHaveLength(1);
    expect(committed.stateUpserts).toEqual([]);
    expect(committed.events).toHaveLength(1);
    const event = committed.events[0] as { data: Record<string, unknown> };
    expect(event.data.action).toBe("skip");
    expect(event.data.response).toEqual({ assignmentId: "assignment-1", status: "done" });
  });

  it("reads the current state after taking the lock", async () => {
    await POST(post(), context);

    expect(committed.stateReads).toHaveLength(1);
    expect(mockExecuteRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mockStateFindUnique.mock.invocationCallOrder[0],
    );
  });

  it("replays the first response for a retried requestId and writes nothing again", async () => {
    const first = await POST(post({ requestId: "req-1" }), context);
    const firstBody = await first.json();
    expect(first.status).toBe(200);

    mockEventFindUnique.mockImplementation(async (args: unknown) => {
      attempt.eventReads.push(args);
      return { response: { assignmentId: "assignment-1", status: "skipped" } };
    });

    const second = await POST(post({ requestId: "req-1" }), context);
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody).toEqual(firstBody);
    expect(committed.stateUpserts).toEqual([]);
    expect(committed.events).toEqual([]);
    expect(committed.eventReads).toHaveLength(1);
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects a requestId longer than 100 characters", async () => {
    const response = await POST(post({ requestId: "r".repeat(101) }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "requestId must be at most 100 characters." });
    expect(mockAssignmentFindFirst).not.toHaveBeenCalled();
    expect(committed.events).toHaveLength(0);
  });

  it("leaves no state change when the event insert fails", async () => {
    mockEventCreate.mockRejectedValue(new Error("insert failed"));

    await expect(POST(post(), context)).rejects.toThrow("insert failed");

    expect(attempt.stateUpserts).toHaveLength(1);
    expect(committed.stateUpserts).toHaveLength(0);
    expect(committed.events).toHaveLength(0);
  });

  it.each([
    { rank: 0 },
    { rank: 1.5 },
    { rank: "2" },
  ])("rejects an invalid rank (%j)", async (body) => {
    const response = await POST(post({ body }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "rank must be a positive integer." });
    expect(committed.events).toHaveLength(0);
  });

  it("rejects a non-object JSON body", async () => {
    const response = await POST(post({ body: [1, 2] }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Body must be a JSON object." });
    expect(committed.events).toHaveLength(0);
  });

  it("rejects an invalid listGeneratedAt", async () => {
    const response = await POST(post({ body: { listGeneratedAt: "yesterday" } }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "listGeneratedAt must be an ISO date-time." });
    expect(committed.events).toHaveLength(0);
  });

  it("records the displayed rank and list timestamp on the event", async () => {
    await POST(post({ body: { rank: 1, listGeneratedAt: "2026-10-14T16:30:00.000Z" } }), context);

    const event = committed.events[0] as { data: Record<string, unknown> };
    expect(event.data.shownRank).toBe(1);
    expect(event.data.listGeneratedAt).toEqual(new Date("2026-10-14T16:30:00.000Z"));
  });

  it("records a null server rank when the item is not in the user's list", async () => {
    mockLoadOpenWork.mockResolvedValue([]);

    await POST(post(), context);

    const event = committed.events[0] as { data: Record<string, unknown> };
    expect(event.data.serverRank).toBeNull();
  });

  it("records the client header as web", async () => {
    await POST(post({ client: "web" }), context);

    const event = committed.events[0] as { data: Record<string, unknown> };
    expect(event.data.client).toBe("web");
  });

  it("records the client header as app", async () => {
    await POST(post({ client: "app" }), context);

    const event = committed.events[0] as { data: Record<string, unknown> };
    expect(event.data.client).toBe("app");
  });

  it("records anything else in the client header as unknown", async () => {
    await POST(post({ client: "motorola" }), context);

    const event = committed.events[0] as { data: Record<string, unknown> };
    expect(event.data.client).toBe("unknown");
  });

  it("404s another user's or a non-current course's assignment and writes no event", async () => {
    mockAssignmentFindFirst.mockResolvedValue(null);

    const response = await POST(post(), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Assignment not found." });
    expect(mockLoadOpenWork).not.toHaveBeenCalled();
    expect(committed.events).toHaveLength(0);
  });

  it("opts out of caching", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
