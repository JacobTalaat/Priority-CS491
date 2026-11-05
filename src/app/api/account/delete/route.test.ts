import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CONFIRM_ATTEMPTS, resetConfirmLimitForTests } from "@/lib/confirm-password-limit";
import { POST } from "./route";

const { mockVerifyAccessToken, mockUserFindUnique, mockUserCreate, mockUserDelete, mockVerifyPassword, mockDeleteAuthUser } =
  vi.hoisted(() => ({
    mockVerifyAccessToken: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockUserCreate: vi.fn(),
    mockUserDelete: vi.fn(),
    mockVerifyPassword: vi.fn(),
    mockDeleteAuthUser: vi.fn(),
  }));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
  verifyPassword: mockVerifyPassword,
  deleteAuthUser: mockDeleteAuthUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, create: mockUserCreate, delete: mockUserDelete },
  },
}));

function deleteRequest(body: string, token?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("http://localhost/api/account/delete", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset();
    mockUserFindUnique.mockReset();
    mockUserCreate.mockReset();
    mockUserDelete.mockReset();
    mockVerifyPassword.mockReset();
    mockDeleteAuthUser.mockReset();
    resetConfirmLimitForTests();
    mockVerifyAccessToken.mockResolvedValue({
      authUserId: "auth-user-1",
      email: "student@example.com",
    });
    // getUserFromRequest looks the row up by its Supabase id; the route then
    // looks it up again by its Prisma id for the authUserId to delete.
    mockUserFindUnique.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if ("authUserId" in args.where) {
        return { id: "authenticated-user", email: "student@example.com" };
      }
      return { authUserId: "auth-user-1" };
    });
    // The mock answers like Supabase would: only the real password passes.
    mockVerifyPassword.mockImplementation(
      async (_email: string, password: string) => password === "correct-password"
    );
    mockDeleteAuthUser.mockResolvedValue(undefined);
    mockUserDelete.mockResolvedValue({});
  });

  it("returns 401 without a bearer token and does not delete a user", async () => {
    const res = await POST(deleteRequest(JSON.stringify({ password: "correct-password" })));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockUserDelete).not.toHaveBeenCalled();
    expect(mockDeleteAuthUser).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not JSON", async () => {
    const res = await POST(deleteRequest("not json", "valid-token"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Password is required." });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it.each([{}, { password: "" }])("returns 400 when password is missing or empty", async (body) => {
    const res = await POST(deleteRequest(JSON.stringify(body), "valid-token"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Password is required." });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });
  it("returns 401 when the row disappears between the auth lookup and the delete", async () => {
    mockUserCreate.mockReset();
    mockUserFindUnique.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if ("authUserId" in args.where) {
        return { id: "authenticated-user", email: "student@example.com" };
      }
      return null;
    });
    const res = await POST(
      deleteRequest(JSON.stringify({ password: "correct-password" }), "valid-token")
    );
    expect(res.status).toBe(401);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("returns 403 when Supabase rejects the password", async () => {
    mockVerifyPassword.mockResolvedValue(false);
    const res = await POST(deleteRequest(JSON.stringify({ password: "wrong-password" }), "valid-token"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Password is incorrect." });
    expect(mockUserDelete).not.toHaveBeenCalled();
    expect(mockDeleteAuthUser).not.toHaveBeenCalled();
  });

  it("deletes the Supabase auth user and then the Prisma row", async () => {
    const res = await POST(
      deleteRequest(
        JSON.stringify({ id: "body-user", password: "correct-password" }),
        "valid-token"
      )
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: true });
    expect(mockVerifyPassword).toHaveBeenCalledWith("student@example.com", "correct-password");
    expect(mockDeleteAuthUser).toHaveBeenCalledExactlyOnceWith("auth-user-1");
    expect(mockUserDelete).toHaveBeenCalledExactlyOnceWith({
      where: { id: "authenticated-user" },
    });
  });

  it("removes the Prisma row before it calls Supabase", async () => {
    const order: string[] = [];
    mockUserDelete.mockImplementation(async () => {
      order.push("prisma");
    });
    mockDeleteAuthUser.mockImplementation(async () => {
      order.push("supabase");
    });
    await POST(deleteRequest(JSON.stringify({ password: "correct-password" }), "valid-token"));
    expect(order).toEqual(["prisma", "supabase"]);
  });

  it("returns 500 without deleting anything when the Prisma row cannot be removed", async () => {
    mockUserDelete.mockRejectedValue(new Error("database down"));
    const res = await POST(deleteRequest(JSON.stringify({ password: "correct-password" }), "valid-token"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Could not delete your account. Try again.",
    });
    expect(mockDeleteAuthUser).not.toHaveBeenCalled();
  });

  it("returns 500 when Supabase refuses to delete the auth user, leaving no data behind it", async () => {
    mockDeleteAuthUser.mockRejectedValue(new Error("Supabase refused"));
    const res = await POST(deleteRequest(JSON.stringify({ password: "correct-password" }), "valid-token"));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Your data was deleted, but your account is still there. Try again.",
    });
    expect(mockUserDelete).toHaveBeenCalledTimes(1);
  });

  it("returns 429 after too many wrong passwords and refuses to delete", async () => {
    for (let index = 0; index < MAX_CONFIRM_ATTEMPTS; index += 1) {
      const attempt = await POST(deleteRequest(JSON.stringify({ password: "wrong" }), "session-token"));
      expect(attempt.status).toBe(403);
    }
    const limited = await POST(deleteRequest(JSON.stringify({ password: "wrong" }), "session-token"));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("a limited account cannot delete even with the correct password", async () => {
    for (let index = 0; index < MAX_CONFIRM_ATTEMPTS; index += 1) {
      await POST(deleteRequest(JSON.stringify({ password: "wrong" }), "session-token"));
    }
    const limited = await POST(deleteRequest(JSON.stringify({ password: "correct-password" }), "session-token"));
    expect(limited.status).toBe(429);
    expect(mockUserDelete).not.toHaveBeenCalled();
    expect(mockDeleteAuthUser).not.toHaveBeenCalled();
  });
});
