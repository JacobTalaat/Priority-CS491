import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/password";
import { resetLoginRateLimitForTests } from "@/lib/login-rate-limit";
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
    resetLoginRateLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
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

  it("blocks the sixth failed attempt without touching Prisma or creating a session", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await POST(loginRequest(validBody));
    }
    mockUserFindUnique.mockClear();
    const res = await POST(loginRequest(validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await res.json()).toEqual({ error: "Too many login attempts" });
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("limits unknown emails the same way", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const unknownBody = JSON.stringify({ email: "unknown@example.com", password: "correct-horse" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await POST(loginRequest(unknownBody));
    }
    const res = await POST(loginRequest(unknownBody));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("clears failed attempts after successful authentication", async () => {
    mockUserFindUnique.mockResolvedValueOnce(null).mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      passwordHash: hashPassword("correct-horse"),
    });
    mockSessionCreate.mockResolvedValue({});
    await POST(loginRequest(validBody));
    const res = await POST(loginRequest(validBody));
    expect(res.status).toBe(200);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      mockUserFindUnique.mockResolvedValue(null);
      await POST(loginRequest(validBody));
    }
    expect((await POST(loginRequest(validBody))).status).toBe(401);
  });

  it("allows a new attempt after the window expires", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await POST(loginRequest(validBody));
    }
    vi.advanceTimersByTime(15 * 60 * 1000);
    const res = await POST(loginRequest(validBody));
    expect(res.status).toBe(401);
    expect(mockUserFindUnique).toHaveBeenCalledTimes(6);
  });
});
