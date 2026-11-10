import { beforeEach, describe, expect, it, vi } from "vitest";

// The module talks to Supabase through the shared browser client, so the
// client is mocked at createClient, the same pattern auth-client.test.ts uses.
const {
  mockCreateClient,
  mockListFactors,
  mockUnenroll,
  mockEnroll,
  mockChallengeAndVerify,
  mockGetAuthenticatorAssuranceLevel,
  mockGetSession,
} = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";
  const client = {
    auth: {
      mfa: {
        listFactors: vi.fn(),
        unenroll: vi.fn(),
        enroll: vi.fn(),
        challengeAndVerify: vi.fn(),
        getAuthenticatorAssuranceLevel: vi.fn(),
      },
      getSession: vi.fn(),
    },
  };
  return {
    mockCreateClient: vi.fn(() => client),
    mockListFactors: client.auth.mfa.listFactors,
    mockUnenroll: client.auth.mfa.unenroll,
    mockEnroll: client.auth.mfa.enroll,
    mockChallengeAndVerify: client.auth.mfa.challengeAndVerify,
    mockGetAuthenticatorAssuranceLevel: client.auth.mfa.getAuthenticatorAssuranceLevel,
    mockGetSession: client.auth.getSession,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import { enrollAuthenticator, verifyAuthenticatorCode } from "./two-factor-client";

const ENROLLMENT = {
  id: "factor-new",
  type: "totp" as const,
  status: "unverified" as const,
  totp: { qr_code: "data:image/svg+xml;base64,PHN2Zy8+", secret: "JBSWY3DPEHPK3PXP" },
};

function factors(...list: Array<{ id: string; factor_type: string; status: string }>) {
  mockListFactors.mockResolvedValue({ data: { all: list }, error: null });
}

describe("enrollAuthenticator", () => {
  beforeEach(() => {
    for (const mock of [mockListFactors, mockUnenroll, mockEnroll, mockChallengeAndVerify, mockGetSession]) {
      mock.mockReset();
    }
    mockGetAuthenticatorAssuranceLevel.mockReset();
    mockEnroll.mockResolvedValue({ data: ENROLLMENT, error: null });
    mockUnenroll.mockResolvedValue({ data: {}, error: null });
  });

  it("unenrolls a leftover unverified TOTP factor before enrolling", async () => {
    factors(
      { id: "stale", factor_type: "totp", status: "unverified" },
      { id: "other", factor_type: "phone", status: "unverified" },
    );
    const result = await enrollAuthenticator();
    expect(mockUnenroll).toHaveBeenCalledTimes(1);
    expect(mockUnenroll).toHaveBeenCalledWith({ factorId: "stale" });
    expect(mockUnenroll.mock.invocationCallOrder[0]).toBeLessThan(mockEnroll.mock.invocationCallOrder[0]);
    expect(result).toEqual({ factorId: "factor-new", qrCode: ENROLLMENT.totp.qr_code, secret: ENROLLMENT.totp.secret });
  });

  it("never unenrolls a verified TOTP factor", async () => {
    factors({ id: "live", factor_type: "totp", status: "verified" });
    await enrollAuthenticator();
    expect(mockUnenroll).not.toHaveBeenCalled();
    expect(mockEnroll).toHaveBeenCalledTimes(1);
  });

  it("still enrolls when listing the factors fails", async () => {
    mockListFactors.mockRejectedValue(new Error("network down"));
    const result = await enrollAuthenticator();
    expect(mockUnenroll).not.toHaveBeenCalled();
    expect(mockEnroll).toHaveBeenCalledTimes(1);
    expect(result?.factorId).toBe("factor-new");
  });

  it("still enrolls when the cleanup unenroll fails", async () => {
    factors({ id: "stale", factor_type: "totp", status: "unverified" });
    mockUnenroll.mockResolvedValue({ data: null, error: { message: "cannot unenroll" } });
    const result = await enrollAuthenticator();
    expect(mockUnenroll).toHaveBeenCalledWith({ factorId: "stale" });
    expect(mockEnroll).toHaveBeenCalledTimes(1);
    expect(result?.factorId).toBe("factor-new");
  });

  it("enrolls once with nothing left behind", async () => {
    factors();
    const result = await enrollAuthenticator();
    expect(mockEnroll).toHaveBeenCalledTimes(1);
    expect(mockUnenroll).not.toHaveBeenCalled();
    expect(result).toEqual({ factorId: "factor-new", qrCode: ENROLLMENT.totp.qr_code, secret: ENROLLMENT.totp.secret });
  });

  it("returns null when the enroll itself is refused", async () => {
    factors();
    mockEnroll.mockResolvedValue({ data: null, error: { message: "enroll refused" } });
    expect(await enrollAuthenticator()).toBeNull();
  });
});

describe("verifyAuthenticatorCode", () => {
  beforeEach(() => {
    for (const mock of [mockChallengeAndVerify, mockGetSession]) {
      mock.mockReset();
    }
  });

  it("hands back the promoted session token after a good code", async () => {
    mockChallengeAndVerify.mockResolvedValue({ data: {}, error: null });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "aal2-token" } } });
    const check = await verifyAuthenticatorCode("factor-1", "123456");
    expect(mockChallengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-1", code: "123456" });
    expect(check).toEqual({ ok: true, token: "aal2-token" });
  });
});
