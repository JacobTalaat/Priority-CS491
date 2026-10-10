import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  deleteSession,
  getSessionFromRequest,
  getUserFromRequest,
  rotateSession,
} from "./auth";

const { mockSessionCreate, mockSessionFindUnique, mockSessionDelete, mockTransaction } =
  vi.hoisted(() => ({
    mockSessionCreate: vi.fn(),
    mockSessionFindUnique: vi.fn(),
    mockSessionDelete: vi.fn(),
    mockTransaction: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: {
      create: mockSessionCreate,
      findUnique: mockSessionFindUnique,
      delete: mockSessionDelete,
    },
    $transaction: mockTransaction,
  },
}));

function requestWithToken(token?: string) {
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("http://localhost/api/auth/me", { headers });
}

describe("createSession", () => {
  beforeEach(() => {
    mockSessionCreate.mockReset();
  });

  it("returns a token and stores only its sha256 hash", async () => {
    mockSessionCreate.mockResolvedValue({});
    const { token, expiresAt } = await createSession("user-1");
    expect(token).toBeTruthy();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    const data = mockSessionCreate.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(data.tokenHash).not.toBe(token);
    expect(data.userId).toBe("user-1");
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("rotateSession", () => {
  beforeEach(() => {
    mockSessionDelete.mockReset();
    mockSessionCreate.mockReset();
    mockTransaction.mockReset();
  });

  it("deletes the old session and creates a new one with a different token hash", async () => {
    mockSessionCreate.mockResolvedValue({});
    const old = await createSession("user-1");
    const oldHash = mockSessionCreate.mock.calls[0][0].data.tokenHash;
    mockSessionDelete.mockReset();
    mockSessionCreate.mockReset();
    mockSessionDelete.mockResolvedValue({});
    mockSessionCreate.mockResolvedValue({});
    mockTransaction.mockImplementation(async (operations: Promise<unknown>[]) => {
      return Promise.all(operations);
    });
    await rotateSession("session-1", "user-1");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockSessionDelete).toHaveBeenCalledWith({ where: { id: "session-1" } });
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    const data = mockSessionCreate.mock.calls[0][0].data;
    expect(data.tokenHash).not.toBe(oldHash);
    expect(data.tokenHash).not.toBe(old.token);
    expect(data.userId).toBe("user-1");
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("stores only a sha256 hash and never the raw token", async () => {
    mockSessionDelete.mockResolvedValue({});
    mockSessionCreate.mockResolvedValue({});
    mockTransaction.mockImplementation(async (operations: Promise<unknown>[]) => {
      return Promise.all(operations);
    });
    const { token } = await rotateSession("session-1", "user-1");
    expect(token).toBeTruthy();
    const data = mockSessionCreate.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(data.tokenHash).not.toBe(token);
  });
});

describe("deleteSession", () => {
  beforeEach(() => {
    mockSessionDelete.mockReset();
  });

  it("deletes the session by id", async () => {
    mockSessionDelete.mockResolvedValue({});
    await deleteSession("session-1");
    expect(mockSessionDelete).toHaveBeenCalledTimes(1);
    expect(mockSessionDelete).toHaveBeenCalledWith({ where: { id: "session-1" } });
  });
});

describe("getSessionFromRequest", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
  });

  it("returns the session id and expiresAt for a valid token", async () => {
    const expiresAt = new Date(Date.now() + 60 * 1000);
    mockSessionFindUnique.mockResolvedValue({
      id: "session-1",
      expiresAt,
      user: { id: "user-1", email: "student@example.com" },
    });
    const session = await getSessionFromRequest(requestWithToken("valid-token"));
    expect(session).toEqual({ id: "session-1", expiresAt, user: { id: "user-1", email: "student@example.com" } });
  });
});

describe("getUserFromRequest", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
  });

  it("returns null when there is no authorization header", async () => {
    const user = await getUserFromRequest(requestWithToken());
    expect(user).toBeNull();
    expect(mockSessionFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when the header is not a Bearer header", async () => {
    const request = new Request("http://localhost/api/auth/me", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    await expect(getUserFromRequest(request)).resolves.toBeNull();
    expect(mockSessionFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when the token is unknown", async () => {
    mockSessionFindUnique.mockResolvedValue(null);
    await expect(getUserFromRequest(requestWithToken("unknown-token"))).resolves.toBeNull();
    expect(mockSessionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: createHash("sha256").update("unknown-token").digest("hex"),
        }),
      })
    );
  });

  it("returns null when the session has expired", async () => {
    mockSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1000),
      user: { id: "user-1", email: "student@example.com" },
    });
    await expect(getUserFromRequest(requestWithToken("expired-token"))).resolves.toBeNull();
  });

  it("returns the user when the session is valid", async () => {
    const user = { id: "user-1", email: "student@example.com" };
    mockSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60 * 1000),
      user,
    });
    await expect(getUserFromRequest(requestWithToken("valid-token"))).resolves.toEqual(user);
  });
});
