import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, mockRunDailyTick } = vi.hoisted(() => ({
  mockEnv: { cronSecret: undefined as string | undefined },
  mockRunDailyTick: vi.fn(),
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

vi.mock("@/lib/jobs/daily-sync", () => ({
  runDailyTick: mockRunDailyTick,
}));

import { GET, POST } from "./route";

const GOOD_SECRET = "cron-secret-that-is-at-least-thirty-two-characters-long";
const GOOD_HEADER = `Bearer ${GOOD_SECRET}`;

function requestWithHeader(method: string, header: string | null) {
  const headers = new Headers();
  if (header !== null) {
    headers.set("Authorization", header);
  }
  return new Request("http://localhost/api/jobs/daily-sync", { method, headers });
}

function tickResult() {
  return {
    day: "2026-10-22",
    attemptedThisTick: 2,
    remaining: 1,
    usersSucceeded: 2,
    usersFailed: 1,
    gradesPosted: 4,
    finished: false,
  };
}

describe("tick auth", () => {
  beforeEach(() => {
    mockEnv.cronSecret = GOOD_SECRET;
    mockRunDailyTick.mockReset().mockResolvedValue(tickResult());
  });

  afterEach(() => {
    mockEnv.cronSecret = undefined;
  });

  it("POST runs a tick when the secret matches", async () => {
    const res = await POST(requestWithHeader("POST", GOOD_HEADER));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(tickResult());
    expect(mockRunDailyTick).toHaveBeenCalledTimes(1);
  });

  it("GET runs the same tick when the secret matches (Vercel Cron sends GET)", async () => {
    const res = await GET(requestWithHeader("GET", GOOD_HEADER));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(tickResult());
    expect(mockRunDailyTick).toHaveBeenCalledTimes(1);
  });

  it("returns 401 without an Authorization header", async () => {
    const res = await POST(requestWithHeader("POST", null));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockRunDailyTick).not.toHaveBeenCalled();
  });

  it("returns 401 when the presented secret is wrong", async () => {
    const res = await POST(requestWithHeader("POST", `Bearer ${"x".repeat(64)}`));
    expect(res.status).toBe(401);
    expect(mockRunDailyTick).not.toHaveBeenCalled();
  });

  it("returns 401 when the presented secret is too short to be the real one", async () => {
    const res = await POST(requestWithHeader("GET", "Bearer short-secret"));
    expect(res.status).toBe(401);
    expect(mockRunDailyTick).not.toHaveBeenCalled();
  });

  it("returns 503 when CRON_SECRET is not configured", async () => {
    mockEnv.cronSecret = undefined;
    const res = await POST(requestWithHeader("POST", GOOD_HEADER));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "Daily sync is not configured. Set CRON_SECRET to at least 32 characters.",
    });
    expect(mockRunDailyTick).not.toHaveBeenCalled();
  });

  it("returns 500 rather than leaking an internal failure", async () => {
    mockRunDailyTick.mockRejectedValue(new Error("db connection ended"));
    const res = await POST(requestWithHeader("POST", GOOD_HEADER));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Daily sync failed" });
  });
});
