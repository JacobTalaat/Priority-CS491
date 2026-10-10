import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSessionFindUnique, mockUserFindUnique, mockSyncUser } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockSyncUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    user: { findUnique: mockUserFindUnique },
  },
}));

vi.mock("@/lib/import/sync", () => ({
  syncUser: mockSyncUser,
}));

import { CanvasError } from "@/lib/canvas";

import { GET, POST } from "./route";

const LAST_SYNCED_AT = new Date("2026-10-07T19:00:00Z");

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

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
    mockSessionFindUnique.mockReset();
    mockUserFindUnique.mockReset();
    mockSyncUser.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 200 with the sync counts and the last-synced time", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
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
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockSyncUser.mockRejectedValue(new Error("Canvas not connected"));
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Canvas not connected" });
  });

  it("returns 400 when Canvas rejects the stored token", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockSyncUser.mockRejectedValue(
      new CanvasError("unauthorized", "Canvas rejected credentials for /api/v1/courses", 401)
    );
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Canvas rejected this token" });
  });

  it("returns 502 on a network error", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockSyncUser.mockRejectedValue(new CanvasError("network", "Canvas request failed before a response"));
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Could not reach Canvas" });
  });

  it("returns 502 on any other Canvas error", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockSyncUser.mockRejectedValue(new CanvasError("http", "Canvas returned 500", 500));
    const res = await POST(syncRequest("POST"));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Canvas request failed" });
  });

  it("returns 500 and does not blame Canvas when the failure is not a Canvas error", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
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
    mockSessionFindUnique.mockReset();
    mockUserFindUnique.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the stored lastSyncedAt", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockResolvedValue({ lastSyncedAt: LAST_SYNCED_AT });
    const res = await GET(syncRequest("GET"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ lastSyncedAt: "2026-10-07T19:00:00.000Z" });
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { lastSyncedAt: true },
    });
  });

  it("returns null when never synced", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockResolvedValue({ lastSyncedAt: null });
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
