import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSessionFindUnique, mockUserDelete } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockUserDelete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    user: { delete: mockUserDelete },
  },
}));

import { DELETE } from "./route";

function request(token = "valid-token", body: unknown = { confirmation: "DELETE" }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("http://localhost/api/auth/account", {
    method: "DELETE",
    headers,
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/auth/account", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue({
      id: "session-1",
      expiresAt: new Date(Date.now() + 60 * 1000),
      user: { id: "user-1", email: "student@example.com" },
    });
    mockUserDelete.mockReset().mockResolvedValue({});
  });

  it("deletes only the authenticated user's account and returns confirmation", async () => {
    const response = await DELETE(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: "user-1" } });
  });

  it("requires an authenticated session", async () => {
    const response = await DELETE(request(""));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it.each([null, {}, { confirmation: "delete" }, { confirmation: "DELETE " }])(
    "requires an exact server-side confirmation",
    async (body) => {
      const response = await DELETE(request("valid-token", body));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Type DELETE to confirm account deletion.",
      });
      expect(mockUserDelete).not.toHaveBeenCalled();
    },
  );
});
