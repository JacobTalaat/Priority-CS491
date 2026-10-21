import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserFromRequest, unauthorized } from "./auth";

const { mockVerifyAccessToken, mockUserFindUnique, mockUserCreate, mockUserUpdate } = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserCreate: vi.fn(),
  mockUserUpdate: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      create: mockUserCreate,
      update: mockUserUpdate,
    },
  },
}));

function requestWithToken(token?: string) {
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return new Request("http://localhost/api/auth/me", { headers });
}

const IDENTITY_A = { authUserId: "auth-user-a", email: "student@example.com" };
const IDENTITY_B = { authUserId: "auth-user-b", email: "other@example.com" };

describe("getUserFromRequest", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset();
    mockUserFindUnique.mockReset();
    mockUserCreate.mockReset();
    mockUserUpdate.mockReset();
  });

  it("returns null when there is no authorization header", async () => {
    const user = await getUserFromRequest(requestWithToken());
    expect(user).toBeNull();
    expect(mockVerifyAccessToken).not.toHaveBeenCalled();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when the header is not a Bearer header", async () => {
    const request = new Request("http://localhost/api/auth/me", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    await expect(getUserFromRequest(request)).resolves.toBeNull();
    expect(mockVerifyAccessToken).not.toHaveBeenCalled();
  });

  it("returns null when the token is missing, malformed, expired, or wrongly signed", async () => {
    // verifyAccessToken answers null for every token Supabase would reject.
    mockVerifyAccessToken.mockResolvedValue(null);
    await expect(getUserFromRequest(requestWithToken("garbage-token"))).resolves.toBeNull();
    expect(mockVerifyAccessToken).toHaveBeenCalledWith("garbage-token");
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("keys the lookup on the token's own subject, so one token can never return another user's row", async () => {
    mockVerifyAccessToken.mockResolvedValueOnce(IDENTITY_A);
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-row-a", email: IDENTITY_A.email });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toEqual({
      id: "user-row-a",
      email: IDENTITY_A.email,
    });
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { authUserId: "auth-user-a" } });

    mockVerifyAccessToken.mockResolvedValueOnce(IDENTITY_B);
    mockUserFindUnique.mockResolvedValueOnce({ id: "user-row-b", email: IDENTITY_B.email });
    await expect(getUserFromRequest(requestWithToken("token-b"))).resolves.toEqual({
      id: "user-row-b",
      email: IDENTITY_B.email,
    });
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { authUserId: "auth-user-b" } });
  });

  it("creates a Prisma row the first time it sees a Supabase account", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue({ id: "user-row-a", email: IDENTITY_A.email });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toEqual({
      id: "user-row-a",
      email: IDENTITY_A.email,
    });
    expect(mockUserCreate).toHaveBeenCalledWith({
      data: { authUserId: "auth-user-a", email: "student@example.com" },
    });
  });

  it("reuses the same Prisma row on the second request instead of creating another", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique.mockResolvedValue({ id: "user-row-a", email: IDENTITY_A.email });
    await expect(getUserFromRequest(requestWithToken("token-a"))).resolves.toEqual({
      id: "user-row-a",
      email: IDENTITY_A.email,
    });
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("adopts an existing row that shares the email when creation races to a unique violation", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_B);
    mockUserFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockUserCreate.mockRejectedValue({ code: "P2002" });
    mockUserUpdate.mockResolvedValue({ id: "user-row-b", email: IDENTITY_B.email });
    await expect(getUserFromRequest(requestWithToken("token-b"))).resolves.toEqual({
      id: "user-row-b",
      email: IDENTITY_B.email,
    });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { email: "other@example.com" },
      data: { authUserId: "auth-user-b" },
    });
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
  });

  it("lets unrelated Prisma errors surface instead of swallowing them", async () => {
    mockVerifyAccessToken.mockResolvedValue(IDENTITY_A);
    mockUserFindUnique.mockRejectedValue(new Error("database down"));
    await expect(getUserFromRequest(requestWithToken("token-a"))).rejects.toThrow("database down");
  });
});

describe("unauthorized", () => {
  it("answers 401 in the same plain shape every protected route shows", async () => {
    const response = unauthorized();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
