import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockGetClaims, mockSignInWithPassword, mockAdminDeleteUser } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
  process.env.SUPABASE_SECRET_KEY ??= "test-secret-key";
  return {
    mockCreateClient: vi.fn(),
    mockGetClaims: vi.fn(),
    mockSignInWithPassword: vi.fn(),
    mockAdminDeleteUser: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import { deleteAuthUser, verifyAccessToken, verifyPassword } from "./supabase";

function clientStub() {
  return {
    auth: {
      getClaims: mockGetClaims,
      signInWithPassword: mockSignInWithPassword,
      admin: { deleteUser: mockAdminDeleteUser },
    },
  };
}

const IDENTITY = { authUserId: "auth-user-1", email: "student@example.com" };

describe("verifyAccessToken", () => {
  beforeEach(() => {
    mockCreateClient.mockReset().mockImplementation(clientStub);
    mockGetClaims.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verifies the token locally with getClaims and returns the account it belongs to", async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: IDENTITY.authUserId, email: IDENTITY.email } },
      error: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyAccessToken("valid-token")).resolves.toEqual(IDENTITY);
    expect(mockGetClaims).toHaveBeenCalledWith("valid-token");
    // No network call for the happy path: verification never leaves the server.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers null for a missing, malformed, expired, or wrongly signed token", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: new Error("not a real JWT") });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not found", { status: 401 })));
    await expect(verifyAccessToken("malformed-token")).resolves.toBeNull();
    await expect(verifyAccessToken("expired-token")).resolves.toBeNull();
  });

  it("answers null when the claims do not name a person", async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: "", email: "student@example.com" } },
      error: null,
    });
    await expect(verifyAccessToken("odd-token")).resolves.toBeNull();
  });

  it("falls back to one authenticated user lookup when the project still signs with HS256", async () => {
    // getClaims cannot verify legacy HS256 tokens locally, so the documented
    // path is a single GET /auth/v1/user carrying the token.
    mockGetClaims.mockResolvedValue({ data: null, error: new Error("HS256 is not supported") });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ id: IDENTITY.authUserId, email: IDENTITY.email }, { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyAccessToken("hs256-token")).resolves.toEqual(IDENTITY);
    expect(fetchMock).toHaveBeenCalledWith("https://test.supabase.co/auth/v1/user", {
      headers: {
        Authorization: "Bearer hs256-token",
        apikey: "test-publishable-key",
      },
    });
  });

  it("answers null when both verification paths fail", async () => {
    mockGetClaims.mockRejectedValue(new Error("network down"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    await expect(verifyAccessToken("token")).resolves.toBeNull();
  });

  it("never exposes the secret key while verifying", async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: IDENTITY.authUserId, email: IDENTITY.email } },
      error: null,
    });
    await verifyAccessToken("valid-token");
    for (const call of mockCreateClient.mock.calls) {
      expect(call[1]).not.toBe("test-secret-key");
    }
  });
});

describe("verifyPassword", () => {
  beforeEach(() => {
    mockCreateClient.mockReset().mockImplementation(clientStub);
    mockSignInWithPassword.mockReset();
  });

  it("accepts the account's password by re-authenticating with Supabase", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null });
    await expect(verifyPassword(IDENTITY.email, "correct-password")).resolves.toBe(true);
  });

  it("rejects a wrong password without revealing why", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials", status: 400 },
    });
    await expect(verifyPassword(IDENTITY.email, "wrong-password")).resolves.toBe(false);
  });
});

describe("deleteAuthUser", () => {
  beforeEach(() => {
    mockCreateClient.mockReset().mockImplementation(clientStub);
    mockAdminDeleteUser.mockReset();
  });

  it("deletes the Supabase auth user with the admin client", async () => {
    mockAdminDeleteUser.mockResolvedValue({ data: {}, error: null });
    await deleteAuthUser(IDENTITY.authUserId);
    expect(mockAdminDeleteUser).toHaveBeenCalledWith(IDENTITY.authUserId);
    expect(mockCreateClient).toHaveBeenLastCalledWith(
      "https://test.supabase.co",
      "test-secret-key",
      expect.anything()
    );
  });

  it("throws when Supabase refuses, so the caller can tell the student to try again", async () => {
    mockAdminDeleteUser.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(deleteAuthUser(IDENTITY.authUserId)).rejects.toThrow("Supabase refused");
    expect(mockAdminDeleteUser).toHaveBeenCalledTimes(1);
  });
});
