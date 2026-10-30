import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUserFindMany,
  mockSyncRunUpsert,
  mockSyncRunUpdate,
  mockSyncRunFindUniqueOrThrow,
  mockSyncAttemptFindMany,
  mockSyncAttemptCreate,
  mockSyncAttemptUpdate,
  mockSyncFailureCreate,
  mockSyncUser,
  mockAcquireSyncLock,
  mockReleaseSyncLock,
} = vi.hoisted(() => ({
  mockUserFindMany: vi.fn(),
  mockSyncRunUpsert: vi.fn(),
  mockSyncRunUpdate: vi.fn(),
  mockSyncRunFindUniqueOrThrow: vi.fn(),
  mockSyncAttemptFindMany: vi.fn(),
  mockSyncAttemptCreate: vi.fn(),
  mockSyncAttemptUpdate: vi.fn(),
  mockSyncFailureCreate: vi.fn(),
  mockSyncUser: vi.fn(),
  mockAcquireSyncLock: vi.fn(),
  mockReleaseSyncLock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mockUserFindMany },
    syncRun: { upsert: mockSyncRunUpsert, update: mockSyncRunUpdate, findUniqueOrThrow: mockSyncRunFindUniqueOrThrow },
    syncAttempt: { findMany: mockSyncAttemptFindMany, create: mockSyncAttemptCreate, update: mockSyncAttemptUpdate },
    syncFailure: { create: mockSyncFailureCreate },
  },
}));

vi.mock("@/lib/import/sync", () => ({
  syncUser: mockSyncUser,
  acquireSyncLock: mockAcquireSyncLock,
  releaseSyncLock: mockReleaseSyncLock,
}));

import { CanvasError } from "@/lib/canvas";
import type { SyncResult } from "@/lib/import/sync";

import { runDailyTick, dayInNewYork } from "./daily-sync";

const TICK_INSTANT = new Date("2026-10-22T04:00:00Z");

// In-memory attempt/run state so several ticks of one day can be simulated.
const attemptRows: Array<{
  id: string;
  runId: string;
  userId: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: string | null;
}> = [];

const runRows: Array<{
  id: string;
  day: string;
  usersTotal: number;
  usersSucceeded: number;
  usersFailed: number;
  gradesPosted: number;
  finishedAt: Date | null;
}> = [];

function okSync(gradesPosted = 0): SyncResult {
  return {
    lastSyncedAt: new Date(),
    courses: 0,
    assignmentGroups: 0,
    assignments: 0,
    grades: 0,
    gradesPosted,
  };
}

function failedSyncAttempt(userId: string, startMs: number) {
  return {
    id: `attempt-${userId}`,
    runId: "run-1",
    userId,
    startedAt: new Date(startMs),
    finishedAt: null,
    outcome: null,
  };
}

function makeClock() {
  let millis = TICK_INSTANT.getTime();
  const clock = () => new Date(millis);
  const advance = (ms: number) => {
    millis += ms;
  };
  return { clock, advance, current: () => new Date(millis) };
}

describe("runDailyTick", () => {
  beforeEach(() => {
    attemptRows.length = 0;
    runRows.length = 0;
    mockUserFindMany.mockReset().mockResolvedValue([{ id: "user-a" }, { id: "user-b" }]);
    mockSyncRunUpsert.mockReset().mockImplementation(async ({ where, create }: { where: { day: string }; create: Record<string, unknown> }) => {
      let run = runRows.find((row) => row.day === where.day);
      if (!run) {
        run = {
          id: "run-1",
          day: where.day,
          usersTotal: 0,
          usersSucceeded: 0,
          usersFailed: 0,
          gradesPosted: 0,
          finishedAt: null,
          ...create,
        };
        runRows.push(run);
      }
      return { ...run };
    });
    mockSyncRunUpdate.mockReset().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const run = runRows.find((row) => row.id === where.id);
      if (!run) {
        throw new Error("missing run");
      }
      for (const [field, value] of Object.entries(data)) {
        if (value && typeof value === "object" && "increment" in (value as object)) {
          run[field as "usersTotal"] += (value as { increment: number }).increment;
        } else {
          (run as unknown as Record<string, unknown>)[field] = value;
        }
      }
      return { ...run };
    });
    mockSyncRunFindUniqueOrThrow.mockReset().mockImplementation(async ({ where }: { where: { id: string } }) => {
      const run = runRows.find((row) => row.id === where.id);
      if (!run) {
        throw new Error("missing run");
      }
      return { ...run };
    });
    mockSyncAttemptFindMany.mockReset().mockImplementation(async ({ where }: { where: { runId: string; startedAt?: { lte: Date }; finishedAt?: null } }) => {
      return attemptRows
        .filter((row) => row.runId === where.runId)
        .filter((row) => ("startedAt" in where && where.startedAt ? row.startedAt <= where.startedAt.lte && row.finishedAt === null : true));
    });
    mockSyncAttemptCreate.mockReset().mockImplementation(async ({ data }: { data: { runId: string; userId: string; finishedAt?: Date; outcome?: string } }) => {
      const row = {
        id: `attempt-${attemptRows.length + 1}`,
        startedAt: TICK_INSTANT,
        finishedAt: null,
        outcome: null,
        ...data,
      };
      attemptRows.push(row);
      return { ...row };
    });
    mockSyncAttemptUpdate.mockReset().mockImplementation(async ({ where, data }: { where: { id: string }; data: { finishedAt: Date; outcome: string } }) => {
      const row = attemptRows.find((candidate) => candidate.id === where.id);
      if (!row) {
        throw new Error("missing attempt");
      }
      row.finishedAt = data.finishedAt;
      row.outcome = data.outcome;
      return { ...row };
    });
    mockSyncFailureCreate.mockReset().mockResolvedValue({});
    mockSyncUser.mockReset().mockResolvedValue(okSync());
    mockAcquireSyncLock.mockReset().mockResolvedValue(true);
    mockReleaseSyncLock.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers with the New York day of the tick", () => {
    expect(dayInNewYork(TICK_INSTANT)).toBe("2026-10-22");
  });

  it("syncs every connected user still owed an attempt today and finishes the run", async () => {
    const { clock } = makeClock();
    const result = await runDailyTick(clock);
    expect(mockSyncUser).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      day: "2026-10-22",
      attemptedThisTick: 2,
      remaining: 0,
      usersSucceeded: 2,
      usersFailed: 0,
      gradesPosted: 0,
      finished: true,
    });
    expect(attemptRows.map((row) => row.outcome)).toEqual(["succeeded", "succeeded"]);
    expect(mockSyncRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ finishedAt: expect.any(Date) }),
      })
    );
  });

  it("never re-attempts a user attempted today and continues with the remaining ones", async () => {
    attemptRows.push({
      id: "attempt-old",
      runId: "run-1",
      userId: "user-a",
      startedAt: TICK_INSTANT,
      finishedAt: TICK_INSTANT,
      outcome: "succeeded",
    });
    mockUserFindMany.mockResolvedValue([{ id: "user-a" }, { id: "user-b" }]);
    const { clock } = makeClock();
    await runDailyTick(clock);
    expect(mockSyncUser).toHaveBeenCalledTimes(1);
    expect(mockSyncUser).toHaveBeenCalledWith("user-b");
    expect(attemptRows).toHaveLength(2);
  });

  it("stops starting users after the tick budget and the next tick resumes with the rest", async () => {
    const { clock, advance } = makeClock();
    mockUserFindMany.mockResolvedValue([{ id: "user-a" }, { id: "user-b" }, { id: "user-c" }]);
    mockSyncUser.mockImplementation(async () => {
      advance(30_000);
      return okSync();
    });
    const first = await runDailyTick(clock);
    expect(first).toMatchObject({ attemptedThisTick: 2, remaining: 1, usersSucceeded: 2, finished: false });
    expect(mockSyncUser).toHaveBeenCalledTimes(2);

    const second = await runDailyTick(clock);
    expect(mockSyncUser).toHaveBeenCalledTimes(3);
    expect(second).toMatchObject({ attemptedThisTick: 1, remaining: 0, usersSucceeded: 3, finished: true });
  });

  it("reaps a stale unfinished attempt as a timeout and never retries that user", async () => {
    attemptRows.push(failedSyncAttempt("user-a", TICK_INSTANT.getTime() - 10 * 60_000));
    mockUserFindMany.mockResolvedValue([{ id: "user-a" }]);
    const { clock } = makeClock();
    const result = await runDailyTick(clock);
    expect(mockSyncUser).not.toHaveBeenCalled();
    expect(attemptRows[0].outcome).toBe("timeout");
    expect(mockSyncFailureCreate).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        userId: "user-a",
        kind: "timeout",
        message: "The sync for this user exceeded its time budget.",
      },
    });
    expect(result).toMatchObject({ attemptedThisTick: 0, remaining: 0, usersFailed: 1, finished: true });
    expect(runRows[0]).toMatchObject({ usersTotal: 0, usersSucceeded: 0, usersFailed: 1 });
  });

  it("counts a reaped stale attempt as failed without adding it to usersTotal", async () => {
    attemptRows.push(failedSyncAttempt("user-a", TICK_INSTANT.getTime() - 10 * 60_000));
    attemptRows.push(failedSyncAttempt("user-b", TICK_INSTANT.getTime() - 10 * 60_000));
    mockUserFindMany.mockResolvedValue([{ id: "user-a" }, { id: "user-b" }]);
    const { clock } = makeClock();
    const result = await runDailyTick(clock);
    expect(mockSyncUser).not.toHaveBeenCalled();
    expect(attemptRows.map((row) => row.outcome)).toEqual(["timeout", "timeout"]);
    expect(runRows[0].usersTotal).toBe(0);
    expect(runRows[0].usersFailed).toBe(2);
    expect(result.usersFailed).toBe(2);
  });

  it("keeps a finished student counted in the run when the tick dies before the next claim", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "user-a" }, { id: "user-b" }]);
    mockAcquireSyncLock.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("host killed the tick"));
    const { clock } = makeClock();
    await expect(runDailyTick(clock)).rejects.toThrow("host killed the tick");
    expect(attemptRows[0]).toMatchObject({ userId: "user-a", outcome: "succeeded" });
    expect(runRows[0]).toMatchObject({ usersTotal: 2, usersSucceeded: 1, usersFailed: 0 });
  });

  it("keeps succeeded plus failed at or below usersTotal across a normal tick", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "user-a" }, { id: "user-b" }]);
    mockSyncUser.mockImplementation((userId: string) => {
      if (userId === "user-a") {
        return Promise.resolve(okSync(2));
      }
      return Promise.reject(new CanvasError("network", "Canvas could not be reached.", 503));
    });
    const { clock } = makeClock();
    const result = await runDailyTick(clock);
    expect(result).toMatchObject({ usersSucceeded: 1, usersFailed: 1 });
    expect(runRows[0].usersSucceeded).toBe(1);
    expect(runRows[0].usersFailed).toBe(1);
    expect(runRows[0].usersSucceeded + runRows[0].usersFailed).toBeLessThanOrEqual(runRows[0].usersTotal);
    expect(runRows[0].usersTotal).toBe(2);
  });

  it("does not reap an unfinished attempt that is still recent enough", async () => {
    attemptRows.push(failedSyncAttempt("user-a", TICK_INSTANT.getTime() - 60_000));
    const { clock } = makeClock();
    mockUserFindMany.mockResolvedValue([{ id: "user-b" }]);
    const result = await runDailyTick(clock);
    expect(attemptRows[0].outcome).toBeNull();
    expect(mockSyncFailureCreate).not.toHaveBeenCalled();
    expect(result.usersFailed).toBe(0);
  });

  it("records skipped-locked without a failure and without counting it as one", async () => {
    mockAcquireSyncLock.mockResolvedValue(false);
    const { clock } = makeClock();
    const result = await runDailyTick(clock);
    expect(mockSyncUser).not.toHaveBeenCalled();
    expect(attemptRows[0]).toMatchObject({ userId: "user-a", outcome: "skipped-locked" });
    expect(attemptRows[1]).toMatchObject({ userId: "user-b", outcome: "skipped-locked" });
    expect(attemptRows[0].finishedAt).not.toBeNull();
    expect(mockSyncFailureCreate).not.toHaveBeenCalled();
    expect(result.usersFailed).toBe(0);
  });

  it("moves on when an overlapping tick already claimed the student today", async () => {
    // The unique (run, user) key rejects the second claim; this tick must neither crash
    // nor sync or lock that student.
    mockSyncAttemptCreate.mockImplementationOnce(async () => {
      throw { code: "P2002" };
    });
    const { clock } = makeClock();
    const result = await runDailyTick(clock);
    expect(mockAcquireSyncLock).not.toHaveBeenCalledWith("user-a");
    expect(mockSyncUser).not.toHaveBeenCalledWith("user-a");
    expect(mockSyncUser).toHaveBeenCalledWith("user-b");
    expect(result.attemptedThisTick).toBe(1);
  });

  it("records the failure with the fixed message, releases the lock, and keeps syncing", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "user-bad" }, { id: "user-good" }]);
    mockSyncUser.mockImplementation((userId: string) => {
      if (userId === "user-bad") {
        return Promise.reject(new CanvasError("unauthorized", "rejected token-tok123 from /api/v1", 401));
      }
      return Promise.resolve(okSync());
    });
    const { clock } = makeClock();
    const result = await runDailyTick(clock);
    expect(result).toMatchObject({ usersSucceeded: 1, usersFailed: 1 });
    expect(mockSyncFailureCreate).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        userId: "user-bad",
        kind: "unauthorized",
        message: "Stored Canvas credentials were rejected by Canvas.",
      },
    });
    expect(mockReleaseSyncLock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/^daily-sync: runId=run-1 kind=unauthorized/)
    );
  });

  it("releases the lock on failure as well", async () => {
    mockSyncUser.mockRejectedValue(new Error("db connection ended"));
    const { clock } = makeClock();
    await runDailyTick(clock);
    expect(mockReleaseSyncLock).toHaveBeenCalledTimes(2);
    expect(mockSyncFailureCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "other", message: "The sync failed for an unexpected reason." }),
      })
    );
  });

  it("sums gradesPosted from every synced user into the day run", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "user-a" }, { id: "user-b" }]);
    mockSyncUser
      .mockResolvedValueOnce(okSync(3))
      .mockResolvedValueOnce(okSync(5));
    const { clock } = makeClock();
    const result = await runDailyTick(clock);
    expect(result.gradesPosted).toBe(8);
  });
});
