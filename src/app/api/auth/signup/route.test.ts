import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { mockUserFindUnique, mockUserCreate, mockSessionCreate } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockUserCreate: vi.fn(),
  mockSessionCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, create: mockUserCreate },
    session: { create: mockSessionCreate },
  },
}));

function signupRequest(body: string) {
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const validBody = JSON.stringify({
  email: "student@example.com",
  password: "correct-horse",
});

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserCreate.mockReset();
    mockSessionCreate.mockReset();
  });

  it("returns 201 and a token for a valid signup", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      passwordHash: "stored",
    });
    mockSessionCreate.mockResolvedValue({});
    const res = await POST(signupRequest(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.expiresAt).toBeTruthy();
    expect(body.user).toEqual({ id: "user-1", email: "student@example.com" });
  });

  it("stores a password hash that is not the plain password", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mockSessionCreate.mockResolvedValue({});
    const res = await POST(
      signupRequest(
        JSON.stringify({ email: "  Student@Example.com ", password: "correct-horse" })
      )
    );
    expect(res.status).toBe(201);
    const data = mockUserCreate.mock.calls[0][0].data;
    expect(data.email).toBe("student@example.com");
    expect(data.passwordHash).not.toBe("correct-horse");
    expect(data.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it("returns 409 when the email is already registered", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "student@example.com" });
    const res = await POST(signupRequest(validBody));
    expect(res.status).toBe(409);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("returns 409 when create hits a unique-constraint error", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockRejectedValue({ code: "P2002" });
    const res = await POST(signupRequest(validBody));
    expect(res.status).toBe(409);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad email", async () => {
    const res = await POST(
      signupRequest(JSON.stringify({ email: "not-an-email", password: "correct-horse" }))
    );
    expect(res.status).toBe(400);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 for a short password", async () => {
    const res = await POST(
      signupRequest(JSON.stringify({ email: "student@example.com", password: "short" }))
    );
    expect(res.status).toBe(400);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await POST(signupRequest("not json"));
    expect(res.status).toBe(400);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });
});
