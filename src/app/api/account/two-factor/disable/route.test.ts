import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

process.env.CANVAS_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const {
  mockVerifyAccessToken,
  mockVerifyStudentTotpCode,
  mockDeleteAllTotpFactors,
  mockUserFindUnique,
  mockUserUpdateMany,
  mockRecoveryCodeDeleteMany,
  mockExecuteRaw,
  mockTransaction,
} = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockVerifyStudentTotpCode: vi.fn(),
  mockDeleteAllTotpFactors: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdateMany: vi.fn(),
  mockRecoveryCodeDeleteMany: vi.fn(),
  mockExecuteRaw: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
  verifyStudentTotpCode: mockVerifyStudentTotpCode,
  listVerifiedTotpFactors: vi.fn(),
  deleteAllTotpFactors: mockDeleteAllTotpFactors,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, updateMany: mockUserUpdateMany },
    recoveryCode: { deleteMany: mockRecoveryCodeDeleteMany },
    $executeRaw: mockExecuteRaw,
    $transaction: mockTransaction,
  },
}));

const AAL2_IDENTITY = {
  authUserId: "auth-user-1",
  email: "student@example.com",
  aal: "aal2",
};

function disableRequest(rawBody: string, token?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("http://localhost/api/account/two-factor/disable", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

describe("POST /api/account/two-factor/disable", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset().mockResolvedValue(AAL2_IDENTITY);
    mockVerifyStudentTotpCode.mockReset().mockResolvedValue("verified");
    mockUserFindUnique
      .mockReset()
      .mockResolvedValue({ id: "user-row-1", email: "student@example.com", twoFactorEnabled: true });
    mockUserUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    mockRecoveryCodeDeleteMany.mockReset().mockResolvedValue({ count: 10 });
    mockDeleteAllTotpFactors.mockReset().mockResolvedValue(undefined);
    mockExecuteRaw.mockReset().mockResolvedValue(undefined);
    mockTransaction
      .mockReset()
      .mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({
          $executeRaw: mockExecuteRaw,
          user: { findUnique: mockUserFindUnique, updateMany: mockUserUpdateMany },
          recoveryCode: { deleteMany: mockRecoveryCodeDeleteMany },
        })
      );
  });

  it("returns 401 for a password-only token, even with two factor on", async () => {
    mockVerifyAccessToken.mockResolvedValue({ ...AAL2_IDENTITY, aal: "aal1" });
    const res = await POST(disableRequest(JSON.stringify({ code: "123456" }), "password-token"));
    expect(res.status).toBe(401);
    expect(mockVerifyStudentTotpCode).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 401 for a rejected token", async () => {
    mockVerifyAccessToken.mockResolvedValue(null);
    const res = await POST(disableRequest(JSON.stringify({ code: "123456" }), "expired-token"));
    expect(res.status).toBe(401);
    expect(mockVerifyStudentTotpCode).not.toHaveBeenCalled();
  });

  it.each(["not json", "null", "{}", '{"code":""}', '{"code":"12345"}', '{"code":"1234567"}'])(
    "refuses the body %s with 400 and touches no factors",
    async (rawBody) => {
      const res = await POST(disableRequest(rawBody, "aal2-token"));
      expect(res.status).toBe(400);
      expect(mockVerifyStudentTotpCode).not.toHaveBeenCalled();
      expect(mockDeleteAllTotpFactors).not.toHaveBeenCalled();
    }
  );

  it("rejects a wrong code with 400 and leaves everything untouched", async () => {
    mockVerifyStudentTotpCode.mockResolvedValue("rejected");
    const res = await POST(disableRequest(JSON.stringify({ code: "111111" }), "aal2-token"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "That code is not right. Try again." });
    expect(mockDeleteAllTotpFactors).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 500 and changes nothing when the check cannot reach Supabase", async () => {
    mockVerifyStudentTotpCode.mockResolvedValue("unreachable");
    const res = await POST(disableRequest(JSON.stringify({ code: "123456" }), "aal2-token"));
    expect(res.status).toBe(500);
    expect(mockDeleteAllTotpFactors).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("sends the code for a server-side check as the student and then clears the state", async () => {
    const res = await POST(disableRequest(JSON.stringify({ code: "123456" }), "aal2-token"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ disabled: true });
    expect(mockVerifyStudentTotpCode).toHaveBeenCalledExactlyOnceWith("auth-user-1", "123456");
    expect(mockDeleteAllTotpFactors).toHaveBeenCalledExactlyOnceWith("auth-user-1");
    expect(mockUserUpdateMany).toHaveBeenCalledWith({
      where: { id: "user-row-1" },
      data: { twoFactorEnabled: false },
    });
    expect(mockRecoveryCodeDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-row-1" } });
  });

  it("holds a per-user advisory lock around the state teardown", async () => {
    await POST(disableRequest(JSON.stringify({ code: "123456" }), "aal2-token"));
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    const lock = mockExecuteRaw.mock.calls[0][0];
    expect(lock.join("")).toContain("pg_advisory_xact_lock");
    expect(mockExecuteRaw.mock.calls[0][1]).toBe("user-row-1");
  });

  it("removes the factors before the database changes go in", async () => {
    const order: string[] = [];
    mockDeleteAllTotpFactors.mockImplementation(async () => {
      order.push("factors");
    });
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      order.push("database");
      mockUserUpdateMany.mockImplementation(async () => {
        order.push("flag");
        return { count: 1 };
      });
      return callback({
        $executeRaw: mockExecuteRaw,
        user: { findUnique: mockUserFindUnique, updateMany: mockUserUpdateMany },
        recoveryCode: { deleteMany: mockRecoveryCodeDeleteMany },
      });
    });
    await POST(disableRequest(JSON.stringify({ code: "123456" }), "aal2-token"));
    expect(order).toEqual(["factors", "database", "flag"]);
  });

  it("returns 500 and keeps the flag on when Supabase refuses the deletion after a good code", async () => {
    mockDeleteAllTotpFactors.mockRejectedValue(new Error("Supabase refused"));
    const res = await POST(disableRequest(JSON.stringify({ code: "123456" }), "aal2-token"));
    expect(res.status).toBe(500);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
