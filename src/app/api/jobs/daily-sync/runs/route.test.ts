import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, mockSyncRunFindMany } = vi.hoisted(() => ({
  mockEnv: { cronSecret: undefined as string | undefined },
  mockSyncRunFindMany: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    // mirrors readEnv: reading cronSecret throws when unset
    get cronSecret() {
      const value = mockEnv.cronSecret;
      if (value === undefined) {
        throw new Error("Missing required environment variable CRON_SECRET");
      }
      return value;
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    syncRun: { findMany: mockSyncRunFindMany },
  },
}));

import { GET } from "./route";

const GOOD_SECRET = "cron-secret-that-is-at-least-thirty-two-characters-long";
const GOOD_HEADER = `Bearer ${GOOD_SECRET}`;

function requestWithHeader(header: string | null) {
  const headers = new Headers();
  if (header !== null) {
    headers.set("Authorization", header);
  }
  return new Request("http://localhost/api/jobs/daily-sync/runs", { method: "GET", headers });
}

function runRow(id: string, day: string, failed: number) {
  return {
    id,
    day,
    startedAt: new Date("2026-10-22T07:00:00Z"),
    finishedAt: new Date("2026-10-22T07:03:00Z"),
    usersTotal: 3,
    usersSucceeded: 3 - failed,
    usersFailed: failed,
    gradesPosted: 4,
  };
}

describe("GET /api/jobs/daily-sync/runs", () => {
  beforeEach(() => {
    mockEnv.cronSecret = GOOD_SECRET;
    mockSyncRunFindMany.mockReset().mockResolvedValue([runRow("run-2", "2026-10-22", 0), runRow("run-1", "2026-10-21", 1)]);
  });

  afterEach(() => {
    mockEnv.cronSecret = undefined;
  });

  it("returns the last 7 runs with their counts", async () => {
    const res = await GET(requestWithHeader(GOOD_HEADER));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      runs: [
        {
          runId: "run-2",
          day: "2026-10-22",
          startedAt: "2026-10-22T07:00:00.000Z",
          finishedAt: "2026-10-22T07:03:00.000Z",
          usersTotal: 3,
          usersSucceeded: 3,
          usersFailed: 0,
          gradesPosted: 4,
        },
        {
          runId: "run-1",
          day: "2026-10-21",
          startedAt: "2026-10-22T07:00:00.000Z",
          finishedAt: "2026-10-22T07:03:00.000Z",
          usersTotal: 3,
          usersSucceeded: 2,
          usersFailed: 1,
          gradesPosted: 4,
        },
      ],
    });
    expect(mockSyncRunFindMany).toHaveBeenCalledWith({
      orderBy: { startedAt: "desc" },
      take: 7,
    });
  });

  it("returns 401 without the shared secret", async () => {
    const res = await GET(requestWithHeader(null));
    expect(res.status).toBe(401);
    expect(mockSyncRunFindMany).not.toHaveBeenCalled();
  });

  it("returns 401 when the presented secret is wrong", async () => {
    const res = await GET(requestWithHeader(`Bearer ${"x".repeat(64)}`));
    expect(res.status).toBe(401);
    expect(mockSyncRunFindMany).not.toHaveBeenCalled();
  });

  it("returns 503 when CRON_SECRET is not configured", async () => {
    mockEnv.cronSecret = undefined;
    const res = await GET(requestWithHeader(GOOD_HEADER));
    expect(res.status).toBe(503);
    expect(mockSyncRunFindMany).not.toHaveBeenCalled();
  });
});
