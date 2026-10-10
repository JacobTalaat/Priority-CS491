import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/password";
import { POST } from "./route";

const { mockUserFindUnique, mockSessionCreate } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockSessionCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    session: { create: mockSessionCreate },
  },
}));

function loginRequest(body: string) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const validBody = JSON.stringify({
  email: "student@example.com",
  password: "correct-horse",
});

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockSessionCreate.mockReset();
  });

  it("returns 200 and a token for correct credentials", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      passwordHash: hashPassword("correct-horse"),
    });
    mockSessionCreate.mockResolvedValue({});
    const res = await POST(loginRequest(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.expiresAt).toBeTruthy();
    expect(body.user).toEqual({ id: "user-1", email: "student@example.com" });
  });

  it("returns 401 for a wrong password", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      passwordHash: hashPassword("correct-horse"),
    });
    const res = await POST(
      loginRequest(JSON.stringify({ email: "student@example.com", password: "wrong-password" }))
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid email or password");
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("returns 401 with the same message for an unknown email", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await POST(loginRequest(validBody));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid email or password");
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body", async () => {
    const res = await POST(loginRequest("not json"));
    expect(res.status).toBe(400);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});
