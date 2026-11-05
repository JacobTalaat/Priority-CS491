import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAccessToken, mockUserFindUnique, mockSyncUser, mockAcquireSyncLock, mockReleaseSyncLock, mockDeliverGradePosted } =
  vi.hoisted(() => ({
    mockVerifyAccessToken: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockSyncUser: vi.fn(),
    mockAcquireSyncLock: vi.fn(),
    mockReleaseSyncLock: vi.fn(),
    mockDeliverGradePosted: vi.fn(),
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
  acquireSyncLock: mockAcquireSyncLock,
  releaseSyncLock: mockReleaseSyncLock,
}));

vi.mock("@/lib/grade-posted-notify", () => ({
  deliverGradePostedNotifications: mockDeliverGradePosted,
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
    mockAcquireSyncLock.mockReset().mockResolvedValue(true);
    mockReleaseSyncLock.mockReset().mockResolvedValue(undefined);
    mockDeliverGradePosted.mockReset();
    mockDeliverGradePosted.mockResolvedValue({ attempted: 0, suppressed: 0 });
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
      gradesPosted: 2,
    });
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      lastSyncedAt: "2026-10-07T19:00:00.000Z",
      courses: 4,
      assignmentGroups: 12,
      assignments: 30,
      grades: 21,
      gradesPosted: 2,
    });
    expect(mockSyncUser).toHaveBeenCalledWith("user-1");
  });

  it("takes the sync lock before syncing and releases it on success", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockResolvedValue({
      lastSyncedAt: LAST_SYNCED_AT,
      courses: 0,
      assignmentGroups: 0,
      assignments: 0,
      grades: 0,
      gradesPosted: 0,
    });
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(200);
    expect(mockAcquireSyncLock).toHaveBeenCalledWith("user-1");
    expect(mockReleaseSyncLock).toHaveBeenCalledWith("user-1");
  });

  it("releases the lock even when the sync fails", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockRejectedValue(new Error("Canvas not connected"));
    await POST(syncRequest("POST"));
    expect(mockReleaseSyncLock).toHaveBeenCalledWith("user-1");
  });

  it("returns 409 without syncing when another sync holds the lock", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockAcquireSyncLock.mockResolvedValue(false);
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "A sync is already running for your account. Try again in a minute.",
    });
    expect(mockSyncUser).not.toHaveBeenCalled();
    expect(mockReleaseSyncLock).not.toHaveBeenCalled();
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

  it("delivers grade pushes after the lock is released, and the 200 body is unchanged", async () => {
    const order: string[] = [];
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockImplementation(async () => {
      order.push("sync");
      return {
        lastSyncedAt: LAST_SYNCED_AT,
        courses: 1,
        assignmentGroups: 0,
        assignments: 2,
        grades: 0,
        gradesPosted: 1,
      };
    });
    mockReleaseSyncLock.mockImplementation(async () => {
      order.push("release");
    });
    mockDeliverGradePosted.mockImplementation(async (userId: string) => {
      order.push(`deliver:${userId}`);
      return { attempted: 1, suppressed: 0 };
    });
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      lastSyncedAt: "2026-10-07T19:00:00.000Z",
      courses: 1,
      assignmentGroups: 0,
      assignments: 2,
      grades: 0,
      gradesPosted: 1,
    });
    expect(order).toEqual(["sync", "release", "deliver:user-1"]);
    expect(mockDeliverGradePosted).toHaveBeenCalledWith("user-1");
  });

  it("delivers grade pushes even when the successful sync posted no new grades", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockResolvedValue({
      lastSyncedAt: LAST_SYNCED_AT,
      courses: 0,
      assignmentGroups: 0,
      assignments: 0,
      grades: 0,
      gradesPosted: 0,
    });
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(200);
    expect(mockDeliverGradePosted).toHaveBeenCalledTimes(1);
  });

  it("a failed sync releases the lock and delivers no grade pushes", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockRejectedValue(new CanvasError("network", "Canvas could not be reached."));
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(502);
    expect(mockReleaseSyncLock).toHaveBeenCalledWith("user-1");
    expect(mockDeliverGradePosted).not.toHaveBeenCalled();
  });

  it("a rejected delivery logs one fixed line and never changes the 200 response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSyncUser.mockResolvedValue({
      lastSyncedAt: LAST_SYNCED_AT,
      courses: 0,
      assignmentGroups: 0,
      assignments: 0,
      grades: 0,
      gradesPosted: 2,
    });
    mockDeliverGradePosted.mockRejectedValue(new Error("deliver exploded"));
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      lastSyncedAt: "2026-10-07T19:00:00.000Z",
      courses: 0,
      assignmentGroups: 0,
      assignments: 0,
      grades: 0,
      gradesPosted: 2,
    });
    expect(console.error).toHaveBeenCalledWith("grade-posted: delivery failed for one user");
    errorSpy.mockRestore();
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
