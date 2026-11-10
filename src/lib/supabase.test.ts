import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockGetClaims,
  mockSignInWithPassword,
  mockAdminDeleteUser,
  mockAdminGetUserById,
  mockAdminListFactors,
  mockAdminDeleteFactor,
  mockStudentListFactors,
  mockStudentChallengeAndVerify,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
  process.env.SUPABASE_SECRET_KEY ??= "test-secret-key";
  return {
    mockCreateClient: vi.fn(),
    mockGetClaims: vi.fn(),
    mockSignInWithPassword: vi.fn(),
    mockAdminDeleteUser: vi.fn(),
    mockAdminGetUserById: vi.fn(),
    mockAdminListFactors: vi.fn(),
    mockAdminDeleteFactor: vi.fn(),
    mockStudentListFactors: vi.fn(),
    mockStudentChallengeAndVerify: vi.fn(),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import {
  authUserExists,
  deleteAllTotpFactors,
  deleteAuthUser,
  emailConfirmationRequired,
  listVerifiedTotpFactors,
  verifyAccessToken,
  verifyPassword,
  verifyStudentTotpCode,
} from "./supabase";

function clientStub() {
  return {
    auth: {
      getClaims: mockGetClaims,
      signInWithPassword: mockSignInWithPassword,
      admin: {
        deleteUser: mockAdminDeleteUser,
        getUserById: mockAdminGetUserById,
        mfa: { listFactors: mockAdminListFactors, deleteFactor: mockAdminDeleteFactor },
      },
      mfa: {
        listFactors: mockStudentListFactors,
        challengeAndVerify: mockStudentChallengeAndVerify,
      },
    },
  };
}

const IDENTITY = { authUserId: "auth-user-1", email: "student@example.com", aal: "aal1" };

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
      data: { claims: { sub: IDENTITY.authUserId, email: IDENTITY.email, aal: "aal1" } },
      error: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyAccessToken("valid-token")).resolves.toEqual(IDENTITY);
    expect(mockGetClaims).toHaveBeenCalledWith("valid-token");
    // No network call for the happy path: verification never leaves the server.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the assurance level from the verified claims", async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: IDENTITY.authUserId, email: IDENTITY.email, aal: "aal2" } },
      error: null,
    });
    await expect(verifyAccessToken("aal2-token")).resolves.toEqual({ ...IDENTITY, aal: "aal2" });
  });

  it("counts a missing or unknown aal as the lower level", async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: IDENTITY.authUserId, email: IDENTITY.email, aal: "aal99" } },
      error: null,
    });
    await expect(verifyAccessToken("odd-aal-token")).resolves.toEqual(IDENTITY);
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: IDENTITY.authUserId, email: IDENTITY.email } },
      error: null,
    });
    await expect(verifyAccessToken("no-aal-token")).resolves.toEqual(IDENTITY);
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

  it("reads the assurance level from the fallback token's own payload", async () => {
    // The fallback lookup proves Supabase accepted the token, so its payload
    // is trusted for the aal without another verification pass.
    const aal2Payload = Buffer.from(
      JSON.stringify({ sub: IDENTITY.authUserId, aal: "aal2" })
    ).toString("base64url");
    const hs256Aal2Token = `header.${aal2Payload}.signature`;
    mockGetClaims.mockResolvedValue({ data: null, error: new Error("HS256 is not supported") });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ id: IDENTITY.authUserId, email: IDENTITY.email }, { status: 200 })
      )
    );
    await expect(verifyAccessToken(hs256Aal2Token)).resolves.toEqual({ ...IDENTITY, aal: "aal2" });
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

describe("emailConfirmationRequired", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads Supabase's public settings and reports confirmation as required when autoconfirm is off", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ mailer: { sender_name: "Priority" }, mailer_autoconfirm: false }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(emailConfirmationRequired(1_000_000)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://test.supabase.co/auth/v1/settings", {
      headers: { apikey: "test-publishable-key" },
    });
  });

  it("reports confirmation as not required when autoconfirm hands out sessions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ mailer_autoconfirm: true }, { status: 200 })),
    );
    await expect(emailConfirmationRequired(2_000_000)).resolves.toBe(false);
  });

  it("serves the cached answer for five minutes without calling Supabase again", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Response.json({ mailer_autoconfirm: true }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(emailConfirmationRequired(3_000_000)).resolves.toBe(false);
    await expect(emailConfirmationRequired(3_000_000 + 5 * 60 * 1000 - 1)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(emailConfirmationRequired(3_000_000 + 5 * 60 * 1000)).resolves.toBe(false);
    // Right at the expiry the fetch happens again — still one cached answer.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("answers null without caching when Supabase cannot be reached", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(emailConfirmationRequired(4_000_000)).resolves.toBeNull();
    // A later request retries rather than trusting the failed read.
    await expect(emailConfirmationRequired(5_000_000)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("answers null when Supabase answers without a boolean autoconfirm", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 200 })));
    await expect(emailConfirmationRequired(6_000_000)).resolves.toBeNull();
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

describe("authUserExists", () => {
  beforeEach(() => {
    mockCreateClient.mockReset().mockImplementation(clientStub);
    mockAdminGetUserById.mockReset();
  });

  it("answers true when Supabase still has the auth user", async () => {
    mockAdminGetUserById.mockResolvedValue({ data: { user: { id: IDENTITY.authUserId } }, error: null });
    await expect(authUserExists(IDENTITY.authUserId)).resolves.toBe(true);
    expect(mockAdminGetUserById).toHaveBeenCalledWith(IDENTITY.authUserId);
    // Only the admin client can look a user up by id with the secret key.
    expect(mockCreateClient).toHaveBeenLastCalledWith(
      "https://test.supabase.co",
      "test-secret-key",
      expect.anything()
    );
  });

  it("answers false when Supabase says the user is gone with a 404", async () => {
    mockAdminGetUserById.mockResolvedValue({
      data: { user: null },
      error: { message: "User not found", status: 404 },
    });
    await expect(authUserExists("deleted-auth-user")).resolves.toBe(false);
  });

  it("answers false on the user_not_found error code whatever the status says", async () => {
    mockAdminGetUserById.mockResolvedValue({
      data: { user: null },
      error: { message: "User not found", code: "user_not_found" },
    });
    await expect(authUserExists("deleted-auth-user")).resolves.toBe(false);
  });

  it("answers null on any other Supabase error so the caller fails closed", async () => {
    mockAdminGetUserById.mockResolvedValue({
      data: { user: null },
      error: { message: "Unauthorized", status: 401 },
    });
    await expect(authUserExists(IDENTITY.authUserId)).resolves.toBeNull();
  });

  it("answers null without a user in the data either", async () => {
    mockAdminGetUserById.mockResolvedValue({ data: { user: null }, error: null });
    await expect(authUserExists(IDENTITY.authUserId)).resolves.toBeNull();
  });

  it("answers null when the lookup throws instead of leaking the failure", async () => {
    mockAdminGetUserById.mockRejectedValue(new Error("network down"));
    await expect(authUserExists(IDENTITY.authUserId)).resolves.toBeNull();
  });
});

const TOTP_FACTOR = { id: "factor-1", factor_type: "totp", status: "verified" };
const UNVERIFIED_TOTP = { id: "factor-2", factor_type: "totp", status: "unverified" };
const PHONE_FACTOR = { id: "factor-3", factor_type: "phone", status: "verified" };

describe("listVerifiedTotpFactors", () => {
  beforeEach(() => {
    mockCreateClient.mockReset().mockImplementation(clientStub);
    mockAdminListFactors.mockReset();
    mockAdminDeleteFactor.mockReset();
  });

  it("lists the verified TOTP factors and nothing else via the admin API", async () => {
    mockAdminListFactors.mockResolvedValue({
      data: { factors: [TOTP_FACTOR, UNVERIFIED_TOTP, PHONE_FACTOR] },
      error: null,
    });
    await expect(listVerifiedTotpFactors(IDENTITY.authUserId)).resolves.toEqual([TOTP_FACTOR]);
    expect(mockAdminListFactors).toHaveBeenCalledWith({ userId: IDENTITY.authUserId });
  });

  it("throws when Supabase refuses the listing", async () => {
    mockAdminListFactors.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(listVerifiedTotpFactors(IDENTITY.authUserId)).rejects.toThrow("Supabase refused");
  });
});

describe("deleteAllTotpFactors", () => {
  beforeEach(() => {
    mockCreateClient.mockReset().mockImplementation(clientStub);
    mockAdminListFactors.mockReset();
    mockAdminDeleteFactor.mockReset();
  });

  it("deletes every TOTP factor, including an unverified one, through the admin API", async () => {
    mockAdminListFactors.mockResolvedValue({
      data: { factors: [TOTP_FACTOR, UNVERIFIED_TOTP, PHONE_FACTOR] },
      error: null,
    });
    mockAdminDeleteFactor.mockResolvedValue({ data: { id: "factor" }, error: null });
    await deleteAllTotpFactors(IDENTITY.authUserId);
    expect(mockAdminDeleteFactor).toHaveBeenCalledTimes(2);
    expect(mockAdminDeleteFactor).toHaveBeenCalledWith({ userId: IDENTITY.authUserId, id: "factor-1" });
    expect(mockAdminDeleteFactor).toHaveBeenCalledWith({ userId: IDENTITY.authUserId, id: "factor-2" });
  });

  it("throws when the listing or one of the deletions fails", async () => {
    mockAdminListFactors.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(deleteAllTotpFactors(IDENTITY.authUserId)).rejects.toThrow("Supabase refused");

    mockAdminListFactors.mockResolvedValue({
      data: { factors: [TOTP_FACTOR] },
      error: null,
    });
    mockAdminDeleteFactor.mockResolvedValue({ data: null, error: { message: "refused" } });
    await expect(deleteAllTotpFactors(IDENTITY.authUserId)).rejects.toThrow("Supabase refused");
  });
});

describe("verifyStudentTotpCode", () => {
  beforeEach(() => {
    mockCreateClient.mockReset().mockImplementation(clientStub);
    mockStudentListFactors.mockReset();
    mockStudentChallengeAndVerify.mockReset();
  });

  it("lists and challenges with the student's own token in the headers, never the secret key", async () => {
    mockStudentListFactors.mockResolvedValue({
      data: { all: [{ id: "factor-1", factor_type: "totp", status: "verified" }] },
      error: null,
    });
    mockStudentChallengeAndVerify.mockResolvedValue({ data: {}, error: null });
    await expect(verifyStudentTotpCode("student-token", "123456")).resolves.toBe("verified");
    expect(mockStudentListFactors).toHaveBeenCalledTimes(1);
    expect(mockStudentChallengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-1", code: "123456" });
    const options = mockCreateClient.mock.calls[0][2];
    expect(options.global.headers.Authorization).toBe("Bearer student-token");
    for (const call of mockCreateClient.mock.calls) {
      expect(call[1]).not.toBe("test-secret-key");
    }
  });

  it("answers rejected for a wrong code and ignores unverified factors", async () => {
    mockStudentListFactors.mockResolvedValue({
      data: { all: [{ id: "factor-2", factor_type: "totp", status: "unverified" }] },
      error: null,
    });
    await expect(verifyStudentTotpCode("student-token", "111111")).resolves.toBe("rejected");
    expect(mockStudentChallengeAndVerify).not.toHaveBeenCalled();

    mockStudentListFactors.mockResolvedValue({
      data: { all: [{ id: "factor-1", factor_type: "totp", status: "verified" }] },
      error: null,
    });
    mockStudentChallengeAndVerify.mockResolvedValue({ data: null, error: { message: "wrong code" } });
    await expect(verifyStudentTotpCode("student-token", "111111")).resolves.toBe("rejected");
  });

  it("answers unreachable when the listing or the verification cannot be read", async () => {
    mockStudentListFactors.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(verifyStudentTotpCode("student-token", "123456")).resolves.toBe("unreachable");
    mockStudentListFactors.mockRejectedValue(new Error("network down"));
    await expect(verifyStudentTotpCode("student-token", "123456")).resolves.toBe("unreachable");
  });
});
