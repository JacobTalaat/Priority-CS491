import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAccessToken, mockUserFindUnique, mockSyncUser } = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockSyncUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
  },
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

vi.mock("@/lib/import/sync", () => ({
  syncUser: mockSyncUser,
}));

import { CanvasError } from "@/lib/canvas";
import { CalendarFeedError } from "@/lib/calendar-feed";

import { GET, POST } from "./route";

const LAST_SYNCED_AT = new Date("2026-10-07T19:00:00Z");


function syncRequest(method: string) {
  return new Request("http://localhost/api/canvas/sync", {
    method,
    headers: { Authorization: "Bearer app-session-token" },
  });
}

function bareRequest(method: string) {
  return new Request("http://localhost/api/canvas/sync", { method });
}

describe("POST /api/canvas/sync", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset().mockResolvedValue({ authUserId: "auth-user-1", email: "student@example.com" });
    mockUserFindUnique.mockReset();
    mockSyncUser.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 200 with the sync counts and the last-synced time", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockResolvedValue({
      lastSyncedAt: LAST_SYNCED_AT,
      courses: 4,
      assignmentGroups: 12,
      assignments: 30,
      grades: 21,
    });
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      lastSyncedAt: "2026-10-07T19:00:00.000Z",
      courses: 4,
      assignmentGroups: 12,
      assignments: 30,
      grades: 21,
    });
    expect(mockSyncUser).toHaveBeenCalledWith("user-1");
  });

  it("returns 409 when Canvas is not connected", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockRejectedValue(new Error("Canvas not connected"));
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Canvas not connected" });
  });

  it("returns 400 when Canvas rejects the stored token", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockRejectedValue(
      new CanvasError("unauthorized", "Canvas rejected credentials for /api/v1/courses", 401)
    );
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Canvas rejected this token" });
  });

  it("returns 502 on a network error", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockRejectedValue(new CanvasError("network", "Canvas request failed before a response"));
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Could not reach Canvas" });
  });

  it("returns 502 on any other Canvas error", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockRejectedValue(new CanvasError("http", "Canvas returned 500", 500));
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Canvas request failed" });
  });

  it("returns a clear error when the saved calendar feed cannot be read", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockRejectedValue(new CalendarFeedError());
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Could not read the Canvas calendar feed. Check that the link is current and publicly accessible.",
    });
  });

  it("returns 500 and does not blame Canvas when the failure is not a Canvas error", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockRejectedValue(new Error("database connection terminated"));
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Sync failed" });
  });

  it("returns 401 without an app session", async () => {
    const res = await POST(bareRequest("POST"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockSyncUser).not.toHaveBeenCalled();
  });
});

describe("GET /api/canvas/sync", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset().mockResolvedValue({ authUserId: "auth-user-1", email: "student@example.com" });
    mockUserFindUnique.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the stored lastSyncedAt", async () => {
    mockUserFindUnique.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where && "authUserId" in args.where) {
        return { id: "user-1", email: "student@example.com" };
      }
      return { lastSyncedAt: LAST_SYNCED_AT };
    });
    const res = await GET(syncRequest("GET"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ lastSyncedAt: "2026-10-07T19:00:00.000Z" });
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { lastSyncedAt: true },
    });
  });

  it("returns null when never synced", async () => {
    mockUserFindUnique.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where && "authUserId" in args.where) {
        return { id: "user-1", email: "student@example.com" };
      }
      return { lastSyncedAt: null };
    });
    const res = await GET(syncRequest("GET"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ lastSyncedAt: null });
  });

  it("returns 401 without an app session", async () => {
    const res = await GET(bareRequest("GET"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});
