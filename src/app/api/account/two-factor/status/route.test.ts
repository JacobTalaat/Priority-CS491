import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { mockVerifyAccessToken, mockUserFindUnique, mockRecoveryCodeCount } = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockRecoveryCodeCount: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    recoveryCode: { count: mockRecoveryCodeCount },
  },
}));

function statusRequest(token?: string) {
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("http://localhost/api/account/two-factor/status", { headers });
}

describe("GET /api/account/two-factor/status", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset().mockResolvedValue({
      authUserId: "auth-user-1",
      email: "student@example.com",
      aal: "aal2",
    });
    mockUserFindUnique
      .mockReset()
      .mockResolvedValue({ id: "user-row-1", email: "student@example.com", twoFactorEnabled: false });
    mockRecoveryCodeCount.mockReset().mockResolvedValue(0);
  });

  it("reports off for a student who never turned two factor on", async () => {
    const res = await GET(statusRequest("token"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ enabled: false, recoveryCodesLeft: 0 });
  });

  it("reports on with the unused codes left for a two factor student with an aal2 token", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-row-1",
      email: "student@example.com",
      twoFactorEnabled: true,
    });
    mockRecoveryCodeCount.mockResolvedValue(7);
    const res = await GET(statusRequest("token"));
    await expect(res.json()).resolves.toEqual({ enabled: true, recoveryCodesLeft: 7 });
  });

  it("answers 401 for a lost session", async () => {
    mockVerifyAccessToken.mockResolvedValue(null);
    const res = await GET(statusRequest("expired-token"));
    expect(res.status).toBe(401);
  });

  it("refuses a password-only token exactly like the gate does for every protected route", async () => {
    // A password-only token for a two factor student cannot even read the
    // status: Settings always asks from the elevated session instead.
    mockVerifyAccessToken.mockResolvedValue({
      authUserId: "auth-user-1",
      email: "student@example.com",
      aal: "aal1",
    });
    mockUserFindUnique.mockResolvedValue({
      id: "user-row-1",
      email: "student@example.com",
      twoFactorEnabled: true,
    });
    const res = await GET(statusRequest("password-token"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
