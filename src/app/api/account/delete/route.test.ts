import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/password";
import { MAX_CONFIRM_ATTEMPTS, resetConfirmLimitForTests } from "@/lib/confirm-password-limit";
import { POST } from "./route";

const { mockSessionFindUnique, mockUserFindUnique, mockUserDelete } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserDelete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    user: { findUnique: mockUserFindUnique, delete: mockUserDelete },
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
    mockSessionFindUnique.mockReset();
    mockUserFindUnique.mockReset();
    mockUserDelete.mockReset();
    resetConfirmLimitForTests();
    mockSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60 * 1000),
      user: { id: "authenticated-user", email: "student@example.com" },
    });
    mockUserFindUnique.mockResolvedValue({ passwordHash: hashPassword("correct-password") });
    mockUserDelete.mockResolvedValue({});
  });

  it("returns 401 without a bearer token and does not delete a user", async () => {
    const res = await POST(deleteRequest(JSON.stringify({ password: "correct-password" })));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockUserDelete).not.toHaveBeenCalled();
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

  it("returns 400 when the password is missing", async () => {
    const response = await POST(deleteRequest(JSON.stringify({}), "session-token"));
    expect(response.status).toBe(400);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("returns 400 when the password is an empty string", async () => {
    const response = await POST(deleteRequest(JSON.stringify({ password: "" }), "session-token"));
    expect(response.status).toBe(400);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("returns 401 when the authenticated user row is gone", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await POST(
      deleteRequest(JSON.stringify({ password: "correct-password" }), "valid-token")
    );
    expect(res.status).toBe(401);
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("returns 403 when the password is incorrect", async () => {
    const res = await POST(deleteRequest(JSON.stringify({ password: "wrong-password" }), "valid-token"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Password is incorrect." });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("deletes only the authenticated user after password confirmation", async () => {
    const res = await POST(
      deleteRequest(
        JSON.stringify({ id: "body-user", password: "correct-password" }),
        "valid-token"
      )
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: true });
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: "authenticated-user" },
      select: { passwordHash: true },
    });
    expect(mockUserDelete).toHaveBeenCalledExactlyOnceWith({
      where: { id: "authenticated-user" },
    });
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
  });
});
