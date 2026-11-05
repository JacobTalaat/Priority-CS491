import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/env", () => ({
  env: { vapidPublicKey: "SERVER-VAPID-PUBLIC-KEY" },
}));

import { GET } from "./route";

function request(withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer app-token");
  }
  return new Request("http://localhost/api/push/public-key", { method: "GET", headers });
}

describe("GET /api/push/public-key", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset().mockResolvedValue({
      authUserId: "auth-user-1",
      email: "student@example.com",
    });
    mockUserFindUnique
      .mockReset()
      .mockResolvedValue({ id: "user-1", email: "student@example.com" });
  });

  it("returns the server's VAPID public key for an authenticated session", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ publicKey: "SERVER-VAPID-PUBLIC-KEY" });
  });

  it("requires an app session like every other route", async () => {
    const res = await GET(request(false));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
