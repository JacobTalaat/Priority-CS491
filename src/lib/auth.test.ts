import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserFromRequest, unauthorized } from "./auth";

const {
  mockVerifyAccessToken,
  mockAuthUserExists,
  mockUserFindUnique,
  mockUserCreate,
  mockUserDeleteMany,
  mockConsoleError,
} = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockAuthUserExists: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserCreate: vi.fn(),
  mockUserDeleteMany: vi.fn(),
  mockConsoleError: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
  authUserExists: mockAuthUserExists,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      create: mockUserCreate,
      deleteMany: mockUserDeleteMany,
    },
  },
}));

vi.stubGlobal("console", { ...console, error: mockConsoleError });

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestWithToken(token?: string) {
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("http://localhost/api/auth/me", { headers });
}

const IDENTITY_A = { authUserId: "auth-user-a", email: "student@example.com" };
const IDENTITY_B = { authUserId: "auth-user-b", email: "other@example.com" };

describe("getUserFromRequest", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset();
    mockAuthUserExists.mockReset();
    mockUserFindUnique.mockReset();
    mockUserCreate.mockReset();
    mockUserDeleteMany.mockReset();
    mockConsoleError.mockReset();
    vi.stubGlobal("console", { ...console, error: mockConsoleError });
    // Default: the auth answer never blocks a create in older tests.
    mockAuthUserExists.mockResolvedValue(true);
  });

  it("returns null when there is no authorization header", async () => {
    const user = await getUserFromRequest(requestWithToken());
    expect(user).toBeNull();
    expect(mockVerifyAccessToken).not.toHaveBeenCalled();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when the header is not a Bearer header", async () => {
    const request = new Request("http://localhost/api/auth/me", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    await expect(getUserFromRequest(request)).resolves.toBeNull();
    expect(mockVerifyAccessToken).not.toHaveBeenCalled();
  });

  it("returns null when the token is missing, malformed, expired, or wrongly signed", async () => {
    // verifyAccessToken answers null for every token Supabase would reject.
    mockVerifyAccessToken.mockResolvedValue(null);
    await expect(getUserFromRequest(requestWithToken("garbage-token"))).resolves.toBeNull();
    expect(mockVerifyAccessToken).toHaveBeenCalledWith("garbage-token");
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("keys the lookup on the token's own subject, so one token can never return another user's row", async () => {
    mockVerifyAccessToken.mockResolvedValueOnce(IDENTITY_A);
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-row-a", email: IDENTITY_A.email });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toEqual({
      id: "user-row-a",
      email: IDENTITY_A.email,
    });
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { authUserId: "auth-user-a" } });
    // The already-existing row path never asks Supabase about the account.
    expect(mockAuthUserExists).not.toHaveBeenCalled();

    mockVerifyAccessToken.mockResolvedValueOnce(IDENTITY_B);
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-row-b", email: IDENTITY_B.email });
    await expect(getUserFromRequest(requestWithToken("token-b"))).resolves.toEqual({
      id: "user-row-b",
      email: IDENTITY_B.email,
    });
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { authUserId: "auth-user-b" } });
  });

  it("creates a Prisma row the first time it sees a Supabase account", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockAuthUserExists.mockResolvedValue(true);
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({ id: "user-row-a", email: IDENTITY_A.email });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toEqual({
      id: "user-row-a",
      email: IDENTITY_A.email,
    });
    expect(mockUserCreate).toHaveBeenCalledWith({
      data: { authUserId: "auth-user-a", email: "student@example.com" },
    });
  });

  it("throws away a just-created row when the auth account is gone by the time the create lands", async () => {
    // The interleaving with account deletion: the pre-create check passed
    // while the account still existed, and the auth user was deleted before
    // the row landed. The row would authenticate forever, so it is removed.
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique.mockResolvedValue(null);
    mockAuthUserExists
      .mockResolvedValueOnce(true) // pre-create check passed
      .mockResolvedValueOnce(false); // deleted in the meantime
    mockUserCreate.mockResolvedValue({ id: "user-row-a", email: IDENTITY_A.email });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toBeNull();
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    expect(mockUserDeleteMany).toHaveBeenCalledWith({
      where: { id: "user-row-a", authUserId: "auth-user-a" },
    });
  });

  it("keeps a just-created row when the post-create check cannot reach Supabase", async () => {
    // Only a definite "gone" removes the row; an outage must not log the
    // student out over it.
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique.mockResolvedValue(null);
    mockAuthUserExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(null);
    mockUserCreate.mockResolvedValue({ id: "user-row-a", email: IDENTITY_A.email });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toEqual({
      id: "user-row-a",
      email: IDENTITY_A.email,
    });
    expect(mockUserDeleteMany).not.toHaveBeenCalled();
  });

  it("reuses the same Prisma row on the second request instead of creating another", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique.mockResolvedValue({ id: "user-row-a", email: IDENTITY_A.email });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toEqual({
      id: "user-row-a",
      email: IDENTITY_A.email,
    });
    expect(mockAuthUserExists).not.toHaveBeenCalled();
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("shows the email the token carries even when the row's copy is older", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique.mockResolvedValue({ id: "user-row-a", email: "old-name@example.com" });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toEqual({
      id: "user-row-a",
      email: "student@example.com",
    });
  });

  it("creates nothing for a token whose auth account has been deleted", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique.mockResolvedValue(null);
    mockAuthUserExists.mockResolvedValue(false);
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toBeNull();
    expect(mockAuthUserExists).toHaveBeenCalledWith("auth-user-a");
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("fails closed when the auth account check is unknown", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique.mockResolvedValue(null);
    mockAuthUserExists.mockResolvedValue(null);
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toBeNull();
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("adopts nothing when two first logins race with the same Supabase id", async () => {
    // Both requests create; one wins the unique authUserId, the other reloads it.
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "user-row-winner", email: IDENTITY_A.email });
    mockUserCreate.mockRejectedValue({ code: "P2002" });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toEqual({
      id: "user-row-winner",
      email: IDENTITY_A.email,
    });
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses to reassign a row whose email belongs to a different account, and leaves the row untouched", async () => {
    // An orphan row holds the email under no Supabase account (or a foreign
    // one): nobody has proven they own the mailbox, so the row must not move.
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockUserCreate.mockRejectedValue({ code: "P2002" });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toBeNull();
    expect(mockConsoleError).toHaveBeenCalledTimes(1);
    expect(String(mockConsoleError.mock.calls[0][0])).not.toContain(IDENTITY_A.email);
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    expect(mockUserDeleteMany).not.toHaveBeenCalled();
  });

  it("returns null for a signup whose email is held by a row whose auth user is gone, without touching that row", async () => {
    // An orphan row holds the email under a deleted auth account. The row is
    // neither adopted nor erased: a fail-closed refusal is the only answer,
    // since erasing would wipe the holder's data if the database is ever
    // pointed at a different Supabase project (every auth id changes there).
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    // 1: no row for this auth user. 2: no race winner.
    mockUserFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockUserCreate.mockRejectedValueOnce({ code: "P2002" });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toBeNull();
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    expect(mockUserDeleteMany).not.toHaveBeenCalled();
    // The holder's id is never even looked up in Supabase.
    expect(mockAuthUserExists).not.toHaveBeenCalledWith("auth-user-old");
    expect(mockConsoleError).toHaveBeenCalledWith(
      "Refusing to reassign a user row to a Supabase account that does not already own it"
    );
  });

  it("rethrows Prisma errors that are not unique-constraint races", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique.mockResolvedValue(null);
    mockAuthUserExists.mockResolvedValue(true);
    mockUserCreate.mockRejectedValue(new Error("connection lost"));
    await expect(getUserFromRequest(requestWithToken("token-a"))).rejects.toThrow("connection lost");
  });
});

describe("unauthorized", () => {
  it("answers 401 in the same plain shape every protected route shows", async () => {
    const response = unauthorized();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
