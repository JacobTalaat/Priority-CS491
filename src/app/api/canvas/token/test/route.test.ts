import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAccessToken, mockUserUpdate, mockUserFindUnique } = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockUserFindUnique: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
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

const IDENTITY = { authUserId: "auth-user-1", email: "student@example.com" };

// getUserFromRequest looks the row up by its Supabase id; the stored-token
// lookup uses the row's own id. One mock serves both.
function stubUserFindUnique(ownLookup: unknown) {
  mockUserFindUnique.mockImplementation(async (args: { where: Record<string, unknown> }) => {
    if (args.where && "authUserId" in args.where) {
      return { id: "user-1", email: "student@example.com" };
    }
    return ownLookup;
  });
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
    mockVerifyAccessToken.mockReset().mockResolvedValue(IDENTITY);
    mockUserUpdate.mockReset();
    mockUserFindUnique.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 200 with the Canvas user and updates canvasCheckedAt", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY);
    stubUserFindUnique(storedRow());
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
    mockVerifyAccessToken.mockResolvedValue(IDENTITY);
    stubUserFindUnique(null);
    const res = await POST(tokenRequest());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Canvas not connected" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 on Canvas 401 and leaves the row intact", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY);
    stubUserFindUnique(storedRow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("{}", { status: 401 })
    ));
    const res = await POST(tokenRequest());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Canvas rejected this token" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 502 on a network error", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY);
    stubUserFindUnique(storedRow());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await POST(tokenRequest());
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Could not reach Canvas" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 and does not blame Canvas when the failure is not a Canvas error", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY);
    stubUserFindUnique(Promise.reject(new Error("database connection terminated")));
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
