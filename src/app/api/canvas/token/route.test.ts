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

import { DELETE, GET, POST } from "./route";

const TOKEN = "canvas-token-123";

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function postRequest(body: unknown, withSession = true): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (withSession) {
    headers.set("Authorization", "Bearer app-session-token");
  }
  return new Request("http://localhost/api/canvas/token", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function getRequest(withSession = true): Request {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer app-session-token");
  }
  return new Request("http://localhost/api/canvas/token", { method: "GET", headers });
}

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

describe("POST /api/canvas/token", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
    mockUserUpdate.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves an encrypted token and returns 200 with the Canvas user", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { id: 42, name: "Student" })));
    const res = await POST(postRequest({ token: TOKEN, baseUrl: "https://canvas.example.edu" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      connected: true,
      canvasUser: { id: 42, name: "Student" },
    });
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    const written = JSON.stringify(mockUserUpdate.mock.calls[0]);
    expect(written).not.toContain(TOKEN);
    expect(written).toContain("canvasTokenCipher");
    const data = mockUserUpdate.mock.calls[0][0].data;
    expect(data.canvasTokenCipher).not.toBe(TOKEN);
    expect(data.canvasBaseUrl).toBe("https://canvas.example.edu");
  });

  it("returns 400 and writes nothing when Canvas rejects the token", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401)));
    const res = await POST(postRequest({ token: TOKEN, baseUrl: "https://canvas.example.edu" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Canvas rejected this token" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad body", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    const res = await POST(postRequest({ token: "" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid body" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad baseUrl", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    const res = await POST(postRequest({ token: TOKEN, baseUrl: "http://canvas.example.edu" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid Canvas URL" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 502 with a clear error when Canvas is unreachable", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await POST(postRequest({ token: TOKEN, baseUrl: "https://canvas.example.edu" }));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "Could not reach Canvas" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

describe("GET /api/canvas/token", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
    mockUserFindUnique.mockReset();
  });

  it("returns the status without a token", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserFindUnique.mockResolvedValue({
      canvasTokenCipher: "cipher",
      canvasBaseUrl: "https://canvas.example.edu",
      canvasCheckedAt: new Date("2026-10-01T12:00:00.000Z"),
    });
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["connected", "baseUrl", "checkedAt"]);
    expect(JSON.stringify(body)).not.toContain("cipher");
  });

  it("returns 401 without a session", async () => {
    mockSessionFindUnique.mockResolvedValue(null);
    const res = await GET(getRequest(false));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});

describe("DELETE /api/canvas/token", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
    mockUserUpdate.mockReset();
  });

  it("clears the credentials", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockUserUpdate.mockResolvedValue({});
    const headers = new Headers({ Authorization: "Bearer app-session-token" });
    const res = await DELETE(
      new Request("http://localhost/api/canvas/token", { method: "DELETE", headers })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ connected: false });
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate.mock.calls[0][0].data).toEqual({
      canvasTokenCipher: null,
      canvasTokenIv: null,
      canvasTokenTag: null,
      canvasBaseUrl: null,
      canvasCheckedAt: null,
    });
  });

  it("returns 401 without a session", async () => {
    mockSessionFindUnique.mockResolvedValue(null);
    const res = await DELETE(
      new Request("http://localhost/api/canvas/token", { method: "DELETE" })
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});

describe("POST /api/canvas/token without a session", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
  });

  it("returns 401 for all three methods", async () => {
    const res = await POST(postRequest({ token: TOKEN }, false));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    mockSessionFindUnique.mockResolvedValue(null);
    const get = await GET(getRequest(false));
    expect(get.status).toBe(401);
    const del = await DELETE(
      new Request("http://localhost/api/canvas/token", { method: "DELETE" })
    );
    expect(del.status).toBe(401);
  });
});
