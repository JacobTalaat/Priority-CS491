import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, hkdfSync } from "node:crypto";
import { MAX_CONFIRM_ATTEMPTS, resetConfirmLimitForTests } from "@/lib/confirm-password-limit";
import { POST } from "./route";

process.env.CANVAS_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const {
  mockVerifyAccessToken,
  mockDeleteAllTotpFactors,
  mockUserFindUnique,
  mockUserUpdateMany,
  mockRecoveryCodeFindFirst,
  mockRecoveryCodeUpdateMany,
  mockRecoveryCodeDeleteMany,
  mockExecuteRaw,
  mockTransaction,
} = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockDeleteAllTotpFactors: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdateMany: vi.fn(),
  mockRecoveryCodeFindFirst: vi.fn(),
  mockRecoveryCodeUpdateMany: vi.fn(),
  mockRecoveryCodeDeleteMany: vi.fn(),
  mockExecuteRaw: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
  listVerifiedTotpFactors: vi.fn(),
  deleteAllTotpFactors: mockDeleteAllTotpFactors,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, updateMany: mockUserUpdateMany },
    recoveryCode: {
      findFirst: mockRecoveryCodeFindFirst,
      updateMany: mockRecoveryCodeUpdateMany,
      deleteMany: mockRecoveryCodeDeleteMany,
    },
    $executeRaw: mockExecuteRaw,
    $transaction: mockTransaction,
  },
}));

const AAL1_IDENTITY = {
  authUserId: "auth-user-1",
  email: "student@example.com",
  aal: "aal1",
};

// What the enable route stored for this code: an HMAC digest of the
// normalized code, under the key derived for this purpose (same hkdf label
// and the same env material the library derives from).
function storedHashOf(code: string): string {
  const derived = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.alloc(32, 7),
      Buffer.alloc(0),
      "priority/recovery-codes/v1",
      32
    )
  );
  return createHmac("sha256", derived).update(code.replace(/[ -]/g, "")).digest("hex");
}

const SHOWN_CODE = "abcd-efgh-jk"; // what the student copies out of the sheet
const STORED_HASH = storedHashOf(SHOWN_CODE);

function recoverRequest(code: string, token = "token") {
  return new Request("http://localhost/api/account/two-factor/recover", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
}

describe("POST /api/account/two-factor/recover", () => {
  beforeEach(() => {
    resetConfirmLimitForTests();
    mockVerifyAccessToken.mockReset().mockResolvedValue(AAL1_IDENTITY);
    // Inside the locked transactions the row is read by its id; two factor is
    // on when recovery is possible.
    mockUserFindUnique
      .mockReset()
      .mockResolvedValue({ id: "user-row-1", email: "student@example.com", twoFactorEnabled: true });
    mockRecoveryCodeFindFirst.mockReset().mockResolvedValue({ id: "code-row-1" });
    mockRecoveryCodeUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    mockRecoveryCodeDeleteMany.mockReset().mockResolvedValue({ count: 9 });
    mockUserUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    mockDeleteAllTotpFactors.mockReset().mockResolvedValue(undefined);
    mockExecuteRaw.mockReset().mockResolvedValue(undefined);
    mockTransaction
      .mockReset()
      .mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({
          $executeRaw: mockExecuteRaw,
          user: { findUnique: mockUserFindUnique, updateMany: mockUserUpdateMany },
          recoveryCode: {
            findFirst: mockRecoveryCodeFindFirst,
            updateMany: mockRecoveryCodeUpdateMany,
            deleteMany: mockRecoveryCodeDeleteMany,
          },
        })
      );
  });

  it("returns 401 without a usable token", async () => {
    mockVerifyAccessToken.mockResolvedValue(null);
    const res = await POST(recoverRequest(SHOWN_CODE, "expired-token"));
    expect(res.status).toBe(401);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for a wrong code without claiming anything", async () => {
    mockRecoveryCodeFindFirst.mockResolvedValue(null);
    const res = await POST(recoverRequest("2222-3333-44"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "That recovery code is not right." });
    expect(mockRecoveryCodeUpdateMany).not.toHaveBeenCalled();
    expect(mockDeleteAllTotpFactors).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body", async () => {
    for (const body of ["not json", null, {}, { code: "" }, { code: 12345 }]) {
      const request = new Request("http://localhost/api/account/two-factor/recover", {
        method: "POST",
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      const res = await POST(request);
      expect(res.status).toBe(400);
    }
    expect(mockRecoveryCodeUpdateMany).not.toHaveBeenCalled();
  });

  it("looks the typed code up by the HMAC of its normalized form", async () => {
    mockRecoveryCodeFindFirst.mockResolvedValue(null);
    await POST(recoverRequest(SHOWN_CODE));
    const where = mockRecoveryCodeFindFirst.mock.calls[0][0].where;
    expect(where.userId).toBe("user-row-1");
    expect(where.codeHash).toBe(STORED_HASH);
    expect(where.usedAt).toBeNull();
  });

  it("normalizes the typed code so dashes, spaces and case do not matter", async () => {
    await POST(recoverRequest("AB CD EF GH JK"));
    expect(mockRecoveryCodeFindFirst.mock.calls[0][0].where.codeHash).toBe(STORED_HASH);
  });

  it("rejects a code whose storage format got junk characters", async () => {
    const res = await POST(recoverRequest("abcd#fghi0j"));
    expect(res.status).toBe(400);
    // No lookup ran at all: junk never becomes a candidate code.
    expect(mockRecoveryCodeFindFirst).not.toHaveBeenCalled();
  });

  it("accepts a valid code and tears two factor down in one transaction", async () => {
    const res = await POST(recoverRequest(SHOWN_CODE));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ recovered: true });
    expect(mockDeleteAllTotpFactors).toHaveBeenCalledExactlyOnceWith("auth-user-1");
    expect(mockUserUpdateMany).toHaveBeenCalledWith({
      where: { id: "user-row-1" },
      data: { twoFactorEnabled: false },
    });
    expect(mockRecoveryCodeDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-row-1" } });
  });

  it("validates and claims inside per-user locked transactions", async () => {
    await POST(recoverRequest(SHOWN_CODE));
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
    for (const call of mockExecuteRaw.mock.calls) {
      const lock = call[0];
      expect(lock.join("")).toContain("pg_advisory_xact_lock");
      expect(call[1]).toBe("user-row-1");
    }
  });

  it("deletes the Supabase factors only after the code proves usable, and claims only after", async () => {
    const order: string[] = [];
    mockRecoveryCodeFindFirst.mockImplementation(async () => {
      order.push("validate");
      return { id: "code-row-1" };
    });
    mockDeleteAllTotpFactors.mockImplementation(async () => {
      order.push("factors");
    });
    mockRecoveryCodeUpdateMany.mockImplementation(async () => {
      order.push("claim");
      return { count: 1 };
    });
    await POST(recoverRequest(SHOWN_CODE));
    expect(order).toEqual(["validate", "factors", "claim"]);
  });

  it("returns 500 and leaves the code unused when Supabase refuses the deletion", async () => {
    mockDeleteAllTotpFactors.mockRejectedValue(new Error("Supabase refused"));
    const res = await POST(recoverRequest(SHOWN_CODE));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Two factor could not be turned off right now. Try again shortly.",
    });
    // The claim never ran, so the same code still works for a retry.
    expect(mockRecoveryCodeUpdateMany).not.toHaveBeenCalled();
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    expect(mockRecoveryCodeDeleteMany).not.toHaveBeenCalled();
  });

  it("spends the code only once: a second use of the same code fails", async () => {
    // After the first success the row is gone: the locked validation read
    // finds nothing, so the second attempt is a plain wrong code.
    mockRecoveryCodeFindFirst
      .mockResolvedValueOnce({ id: "code-row-1" })
      .mockResolvedValue(null);
    const first = await POST(recoverRequest(SHOWN_CODE));
    expect(first.status).toBe(200);
    const second = await POST(recoverRequest(SHOWN_CODE));
    expect(second.status).toBe(400);
    // Supabase was not asked again on the second attempt: the validation
    // stopped it.
    expect(mockDeleteAllTotpFactors).toHaveBeenCalledTimes(1);
    // And the claim update ran only for the successful attempt.
    expect(mockRecoveryCodeUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects codes that belong to another account", async () => {
    mockUserFindUnique.mockReset().mockResolvedValue({
      id: "user-row-2",
      email: "other@example.com",
      twoFactorEnabled: true,
    });
    mockRecoveryCodeFindFirst.mockResolvedValue(null);
    const res = await POST(recoverRequest(SHOWN_CODE));
    expect(res.status).toBe(400);
    // The lookup was scoped to the caller's user id, so the other account's
    // code can never be claimed from here.
    expect(mockRecoveryCodeFindFirst.mock.calls[0][0].where.userId).toBe("user-row-2");
  });

  it("rejects a code after two factor is already off — a stale code cannot act", async () => {
    mockUserFindUnique.mockReset().mockResolvedValue({
      id: "user-row-1",
      email: "student@example.com",
      twoFactorEnabled: false,
    });
    const res = await POST(recoverRequest(SHOWN_CODE));
    expect(res.status).toBe(400);
    expect(mockDeleteAllTotpFactors).not.toHaveBeenCalled();
    expect(mockRecoveryCodeUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 429 after too many wrong codes and never claims a good code then", async () => {
    mockRecoveryCodeFindFirst.mockResolvedValue(null);
    for (let index = 0; index < MAX_CONFIRM_ATTEMPTS; index += 1) {
      await POST(recoverRequest("2222-3333-44"));
    }
    const limited = await POST(recoverRequest(SHOWN_CODE));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    // A limited account never reaches the validation read, let alone a claim.
    expect(mockTransaction).toHaveBeenCalledTimes(MAX_CONFIRM_ATTEMPTS);
    expect(mockDeleteAllTotpFactors).not.toHaveBeenCalled();
  });

  it("clears the wrong-attempt limit for the same user once a code is accepted", async () => {
    // A correct code first: the acceptance wipes the counter for this account.
    const accepted = await POST(recoverRequest(SHOWN_CODE));
    expect(accepted.status).toBe(200);
    // Then the full budget of wrong codes, none of them limited...
    mockRecoveryCodeFindFirst.mockResolvedValue(null);
    for (let index = 0; index < MAX_CONFIRM_ATTEMPTS; index += 1) {
      const attempt = await POST(recoverRequest("2222-3333-44"));
      expect(attempt.status).toBe(400);
    }
    // ...and only the attempt after those is, which proves the limit started
    // from zero after the accepted code rather than keeping earlier failures.
    const limited = await POST(recoverRequest("2222-3333-44"));
    expect(limited.status).toBe(429);
  });
});
