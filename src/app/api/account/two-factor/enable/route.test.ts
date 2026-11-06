import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { RECOVERY_ALPHABET } from "@/lib/two-factor-codes";
import { POST } from "./route";

process.env.CANVAS_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const {
  mockVerifyAccessToken,
  mockListVerifiedTotpFactors,
  mockUserFindUnique,
  mockUserUpdateMany,
  mockRecoveryCodeDeleteMany,
  mockRecoveryCodeCreateMany,
  mockExecuteRaw,
  mockTransaction,
} = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockListVerifiedTotpFactors: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdateMany: vi.fn(),
  mockRecoveryCodeDeleteMany: vi.fn(),
  mockRecoveryCodeCreateMany: vi.fn(),
  mockExecuteRaw: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
  listVerifiedTotpFactors: mockListVerifiedTotpFactors,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, updateMany: mockUserUpdateMany },
    recoveryCode: { deleteMany: mockRecoveryCodeDeleteMany, createMany: mockRecoveryCodeCreateMany },
    $executeRaw: mockExecuteRaw,
    $transaction: mockTransaction,
  },
}));

const AAL2_IDENTITY = {
  authUserId: "auth-user-1",
  email: "student@example.com",
  aal: "aal2",
};

// Runs the route's transaction callback against a fake tx wired to the mocks,
// the way the route expects prisma.$transaction to behave.
function wireTransaction() {
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({
      $executeRaw: mockExecuteRaw,
      user: { findUnique: mockUserFindUnique, updateMany: mockUserUpdateMany },
      recoveryCode: { deleteMany: mockRecoveryCodeDeleteMany, createMany: mockRecoveryCodeCreateMany },
    })
  );
}

function enableRequest(token?: string) {
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("http://localhost/api/account/two-factor/enable", {
    method: "POST",
    headers,
  });
}

describe("POST /api/account/two-factor/enable", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset().mockResolvedValue(AAL2_IDENTITY);
    mockUserFindUnique
      .mockReset()
      // The only row read is the one inside the locked transaction, by id.
      .mockResolvedValue({ id: "user-row-1", email: "student@example.com", twoFactorEnabled: false });
    mockListVerifiedTotpFactors.mockReset().mockResolvedValue([{ id: "factor-1" }]);
    mockUserUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    mockRecoveryCodeDeleteMany.mockReset().mockResolvedValue({ count: 0 });
    mockRecoveryCodeCreateMany.mockReset().mockResolvedValue({ count: 10 });
    mockExecuteRaw.mockReset().mockResolvedValue(undefined);
    wireTransaction();
  });

  it("returns 401 for an aal1 password token", async () => {
    mockVerifyAccessToken.mockResolvedValue({
      authUserId: "auth-user-1",
      email: "student@example.com",
      aal: "aal1",
    });
    const res = await POST(enableRequest("password-token"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockRecoveryCodeCreateMany).not.toHaveBeenCalled();
  });

  it("returns 401 for a rejected token before touching anything else", async () => {
    mockVerifyAccessToken.mockResolvedValue(null);
    const res = await POST(enableRequest("expired-token"));
    expect(res.status).toBe(401);
    expect(mockListVerifiedTotpFactors).not.toHaveBeenCalled();
    expect(mockRecoveryCodeCreateMany).not.toHaveBeenCalled();
  });

  it("returns 400 when no verified TOTP factor exists at Supabase", async () => {
    mockListVerifiedTotpFactors.mockResolvedValue([]);
    const res = await POST(enableRequest("aal2-token"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "No verified authenticator app was found. Scan the QR code and verify it first.",
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("refuses with 409 inside the locked transaction when two factor is already on", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-row-1", twoFactorEnabled: true });
    const res = await POST(enableRequest("aal2-token"));
    expect(res.status).toBe(409);
    // The already-on branch leaves the row untouched: no codes were wiped and
    // none were created.
    expect(mockRecoveryCodeDeleteMany).not.toHaveBeenCalled();
    expect(mockRecoveryCodeCreateMany).not.toHaveBeenCalled();
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });

  it("locks the user row for the whole lifecycle change", async () => {
    await POST(enableRequest("aal2-token"));
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    const lock = mockExecuteRaw.mock.calls[0][0];
    expect(lock.join("")).toContain("pg_advisory_xact_lock");
    expect(mockExecuteRaw.mock.calls[0][1]).toBe("user-row-1");
  });

  it("replaces any stale codes from an earlier setup before creating the new ones", async () => {
    mockRecoveryCodeDeleteMany.mockResolvedValue({ count: 3 });
    const res = await POST(enableRequest("aal2-token"));
    expect(res.status).toBe(200);
    expect(mockRecoveryCodeDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-row-1" } });
    const order = [
      mockRecoveryCodeDeleteMany.mock.invocationCallOrder[0],
      mockRecoveryCodeCreateMany.mock.invocationCallOrder[0],
      mockUserUpdateMany.mock.invocationCallOrder[0],
    ];
    expect([order[0], order[1], order[2]]).toEqual([...order].sort((a, b) => a - b));
    expect(mockUserUpdateMany).toHaveBeenCalledWith({
      where: { id: "user-row-1" },
      data: { twoFactorEnabled: true },
    });
  });

  it("hands the codes out exactly once and in the display format", async () => {
    const res = await POST(enableRequest("aal2-token"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recoveryCodes: string[] };
    expect(body.recoveryCodes).toHaveLength(10);
    expect(new Set(body.recoveryCodes).size).toBe(10);
    const codePattern = new RegExp(
      `^[${RECOVERY_ALPHABET}]{4}-[${RECOVERY_ALPHABET}]{4}-[${RECOVERY_ALPHABET}]{2}$`
    );
    for (const code of body.recoveryCodes) {
      expect(code).toMatch(codePattern);
    }
  });

  it("stores HMAC digests of the codes and never the plaintext or a plain sha256", async () => {
    const res = await POST(enableRequest("aal2-token"));
    const body = (await res.json()) as { recoveryCodes: string[] };
    const stored = mockRecoveryCodeCreateMany.mock.calls[0][0].data;
    expect(stored).toHaveLength(10);
    expect(new Set(stored.map((entry: { codeHash: string }) => entry.codeHash)).size).toBe(10);
    const plainDigests = body.recoveryCodes.flatMap((code: string) => [
      createHash("sha256").update(code.replace(/-/g, "")).digest("hex"),
      createHash("sha256").update(code).digest("hex"),
    ]);
    for (const entry of stored) {
      expect(entry.codeHash).toMatch(/^[0-9a-f]{64}$/);
      // A plain digest of any shown code — canonical or pretty — is not what
      // was stored: the hash only reproduces under the derived HMAC key.
      expect(plainDigests).not.toContain(entry.codeHash);
    }
    // No plaintext code ever reaches the write.
    for (const code of body.recoveryCodes) {
      expect(JSON.stringify(stored)).not.toContain(code);
      expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, ""));
    }
  });

  it("leaves everything uncommitted when writing the codes fails", async () => {
    mockRecoveryCodeCreateMany.mockRejectedValue(new Error("database refused"));
    await expect(POST(enableRequest("aal2-token"))).rejects.toThrow("database refused");
    // The failure happened before the flag write, and a transaction would
    // roll the code deletion back too: nothing about two factor turned on.
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });

  it("asks the admin MFA API for the factor belonging to the caller", async () => {
    await POST(enableRequest("aal2-token"));
    expect(mockListVerifiedTotpFactors).toHaveBeenCalledExactlyOnceWith("auth-user-1");
  });
});
