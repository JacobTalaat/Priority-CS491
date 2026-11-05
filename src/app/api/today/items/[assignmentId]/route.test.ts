import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    assignment: { findFirst: mockAssignmentFindFirst },
    $transaction: mockTransaction,
  },
}));

import { DELETE, dynamic } from "./route";

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

describe("DELETE /api/today/items/[assignmentId] (undo)", () => {
  beforeEach(() => {
    attempt = freshJournal();
    committed = freshJournal();

    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockAssignmentFindFirst.mockReset().mockResolvedValue(ASSIGNMENT_ROW);

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
      return { count: 1 };
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

  function request({ withSession = true, body, client, requestId }: { withSession?: boolean; body?: unknown; client?: string; requestId?: string } = {}) {
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
    return new Request("http://localhost/api/today/items/assignment-1", {
      method: "DELETE",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  const context = { params: Promise.resolve({ assignmentId: "assignment-1" }) };

  it("requires an app session", async () => {
    const response = await DELETE(request({ withSession: false }), context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockAssignmentFindFirst).not.toHaveBeenCalled();
    expect(committed.events).toHaveLength(0);
  });

  it("removes the student's own state and writes exactly one undo event", async () => {
    const response = await DELETE(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ assignmentId: "assignment-1", undone: true });
    expect(mockAssignmentFindFirst).toHaveBeenCalledTimes(1);
    expect(mockAssignmentFindFirst).toHaveBeenCalledWith({
      where: { id: "assignment-1", course: { userId: "user-1", isCurrent: true } },
      select: { id: true, courseId: true, canvasId: true },
    });
    expect(committed.stateDeletes).toHaveLength(1);
    expect(committed.stateDeletes[0]).toEqual({
      where: { userId: "user-1", assignmentId: "assignment-1" },
    });
    expect(committed.events).toHaveLength(1);
    expect(committed.events[0]).toEqual({
      data: {
        userId: "user-1",
        assignmentId: "assignment-1",
        courseId: "course-1",
        assignmentCanvasId: "canvas-1",
        action: "undo",
        client: "unknown",
        requestId: null,
        shownRank: null,
        listGeneratedAt: null,
        serverRank: null,
        response: { assignmentId: "assignment-1", undone: true },
      },
    });
  });

  it("reports undone false when there was no state to remove, and still logs the tap", async () => {
    mockStateDeleteMany.mockImplementation(async (args: unknown) => {
      attempt.stateDeletes.push(args);
      return { count: 0 };
    });

    const response = await DELETE(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ assignmentId: "assignment-1", undone: false });
    expect(committed.events).toHaveLength(1);
  });

  it("ignores a request body and keeps working", async () => {
    const response = await DELETE(request({ body: { rank: 1 } }), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ assignmentId: "assignment-1", undone: true });
  });

  it("takes the lock and writes state and event in one transaction", async () => {
    await DELETE(request(), context);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(committed.locks).toHaveLength(1);
    expect(committed.stateDeletes).toHaveLength(1);
    expect(committed.events).toHaveLength(1);
    const lock = committed.locks[0] as [TemplateStringsArray, string, string];
    expect(lock[0].join("")).toContain("pg_advisory_xact_lock");
    expect(lock.slice(1)).toEqual(["user-1", "assignment-1"]);
    expect(mockExecuteRaw.mock.invocationCallOrder[0]).toBeLessThan(mockStateDeleteMany.mock.invocationCallOrder[0]);
  });

  it("leaves no state change when the event insert fails", async () => {
    mockEventCreate.mockRejectedValue(new Error("insert failed"));

    await expect(DELETE(request(), context)).rejects.toThrow("insert failed");

    expect(attempt.stateDeletes).toHaveLength(1);
    expect(committed.stateDeletes).toHaveLength(0);
    expect(committed.events).toHaveLength(0);
  });

  it("replays the first response for a retried requestId and writes nothing again", async () => {
    const first = await DELETE(request({ requestId: "req-1" }), context);
    const firstBody = await first.json();
    expect(first.status).toBe(200);

    mockEventFindUnique.mockImplementation(async (args: unknown) => {
      attempt.eventReads.push(args);
      return { response: { assignmentId: "assignment-1", undone: true } };
    });

    const second = await DELETE(request({ requestId: "req-1" }), context);
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody).toEqual(firstBody);
    expect(committed.stateDeletes).toEqual([]);
    expect(committed.events).toEqual([]);
    expect(committed.eventReads).toHaveLength(1);
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects a requestId longer than 100 characters", async () => {
    const response = await DELETE(request({ requestId: "r".repeat(101) }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "requestId must be at most 100 characters." });
    expect(mockAssignmentFindFirst).not.toHaveBeenCalled();
    expect(committed.events).toHaveLength(0);
  });

  it("records the client header as web", async () => {
    await DELETE(request({ client: "web" }), context);

    const event = committed.events[0] as { data: Record<string, unknown> };
    expect(event.data.client).toBe("web");
  });

  it("records the client header as app", async () => {
    await DELETE(request({ client: "app" }), context);

    const event = committed.events[0] as { data: Record<string, unknown> };
    expect(event.data.client).toBe("app");
  });

  it("records anything else in the client header as unknown", async () => {
    await DELETE(request({ client: "curl/8" }), context);

    const event = committed.events[0] as { data: Record<string, unknown> };
    expect(event.data.client).toBe("unknown");
  });

  it("404s another user's or a non-current course's assignment and writes no event", async () => {
    mockAssignmentFindFirst.mockResolvedValue(null);

    const response = await DELETE(request(), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Assignment not found." });
    expect(committed.events).toHaveLength(0);
  });

  it("opts out of caching", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
