import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { mockSessionFindUnique, mockSessionDelete, mockSessionCreate, mockTransaction } =
  vi.hoisted(() => ({
    mockSessionFindUnique: vi.fn(),
    mockSessionDelete: vi.fn(),
    mockSessionCreate: vi.fn(),
    mockTransaction: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: {
      findUnique: mockSessionFindUnique,
      delete: mockSessionDelete,
      create: mockSessionCreate,
    },
    $transaction: mockTransaction,
  },
}));

function refreshRequest(token?: string) {
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("http://localhost/api/auth/refresh", { method: "POST", headers });
}

describe("POST /api/auth/refresh", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
    mockSessionDelete.mockReset();
    mockSessionCreate.mockReset();
    mockTransaction.mockReset();
  });

  it("returns 200 with a new token, expiry, and the user for a valid token", async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: "session-1",
      expiresAt: new Date(Date.now() + 60 * 1000),
      user: { id: "user-1", email: "student@example.com" },
    });
    mockSessionDelete.mockResolvedValue({});
    mockSessionCreate.mockResolvedValue({});
    mockTransaction.mockImplementation(async (operations: Promise<unknown>[]) => {
      return Promise.all(operations);
    });
    const res = await POST(refreshRequest("old-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.token).not.toBe("old-token");
    expect(typeof body.expiresAt).toBe("string");
    expect(body.user).toEqual({ id: "user-1", email: "student@example.com" });
  });

  it("rotates the session by deleting the old row inside one transaction", async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: "session-1",
      expiresAt: new Date(Date.now() + 60 * 1000),
      user: { id: "user-1", email: "student@example.com" },
    });
    mockSessionDelete.mockResolvedValue({});
    mockSessionCreate.mockResolvedValue({});
    mockTransaction.mockImplementation(async (operations: Promise<unknown>[]) => {
      return Promise.all(operations);
    });
    await POST(refreshRequest("old-token"));
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockSessionDelete).toHaveBeenCalledWith({ where: { id: "session-1" } });
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 401 without an authorization header", async () => {
    const res = await POST(refreshRequest());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockSessionFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown token", async () => {
    mockSessionFindUnique.mockResolvedValue(null);
    const res = await POST(refreshRequest("unknown-token"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("returns 401 and creates no session when the token is expired", async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: "session-1",
      expiresAt: new Date(Date.now() - 1000),
      user: { id: "user-1", email: "student@example.com" },
    });
    const res = await POST(refreshRequest("expired-token"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockSessionDelete).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
