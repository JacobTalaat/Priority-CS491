import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { mockVerifyAccessToken, mockUserFindUnique } = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockUserFindUnique: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
  },
}));

function meRequest(token?: string) {
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("http://localhost/api/auth/me", { headers });
}

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset();
    mockUserFindUnique.mockReset();
  });

  it("returns 401 without a token", async () => {
    const res = await GET(meRequest());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockVerifyAccessToken).not.toHaveBeenCalled();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 401 for a token Supabase would reject", async () => {
    mockVerifyAccessToken.mockResolvedValue(null);
    const res = await GET(meRequest("nope"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 200 with the Prisma user for a valid Supabase token", async () => {
    mockVerifyAccessToken.mockResolvedValue({
      authUserId: "auth-user-1",
      email: "student@example.com",
    });
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    const res = await GET(meRequest("valid-token"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "user-1", email: "student@example.com" });
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { authUserId: "auth-user-1" } });
  });
});
