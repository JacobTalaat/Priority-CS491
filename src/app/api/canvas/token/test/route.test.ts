import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSessionFindUnique, mockUserUpdate, mockUserFindUnique } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockUserFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    user: { update: mockUserUpdate, findUnique: mockUserFindUnique },
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    get canvasTokenEncryptionKey() {
      return Buffer.alloc(32).toString("base64");
    },
    get canvasBaseUrl() {
      return "https://canvas.example.edu";
    },
  },
}));

import { encryptSecret } from "@/lib/secrets";

import { POST } from "./route";

const STORED_TOKEN = "stored-canvas-token";

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

function storedRow() {
  const parts = encryptSecret(STORED_TOKEN);
  return {
    canvasTokenCipher: parts.cipher,
    canvasTokenIv: parts.iv,
    canvasTokenTag: parts.tag,
    canvasBaseUrl: "https://canvas.example.edu",
  };
}

function tokenRequest() {
  return new Request("http://localhost/api/canvas/token/test", {
    method: "POST",
    headers: { Authorization: "Bearer app-session-token" },
  });
}

describe("POST /api/canvas/token/test", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
    mockUserUpdate.mockReset();
    mockUserFindUnique.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 200 with the Canvas user and updates canvasCheckedAt", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockResolvedValue(storedRow());
    mockUserUpdate.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 42, name: "Student" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ));
    const res = await POST(tokenRequest());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      canvasUser: { id: 42, name: "Student" },
    });
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate.mock.calls[0][0].data.canvasCheckedAt).toBeInstanceOf(Date);
  });

  it("returns 409 when Canvas is not connected", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockResolvedValue(null);
    const res = await POST(tokenRequest());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Canvas not connected" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 on Canvas 401 and leaves the row intact", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockResolvedValue(storedRow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("{}", { status: 401 })
    ));
    const res = await POST(tokenRequest());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Canvas rejected this token" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 502 on a network error", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockResolvedValue(storedRow());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await POST(tokenRequest());
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Could not reach Canvas" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 and does not blame Canvas when the failure is not a Canvas error", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockRejectedValue(new Error("database connection terminated"));
    const res = await POST(tokenRequest());
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Token check failed" });
  });

  it("returns 401 without an app session", async () => {
    const res = await POST(
      new Request("http://localhost/api/canvas/token/test", { method: "POST" })
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});
