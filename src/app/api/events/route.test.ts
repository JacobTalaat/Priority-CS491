import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAccessToken, mockUserFindUnique, mockUsageEventCreate } = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUsageEventCreate: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerifyAccessToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    usageEvent: { create: mockUsageEventCreate },
  },
}));

import { POST } from "./route";

function authUserRow() {
  return { id: "user-1", email: "student@example.com" };
}

function eventRequest(body: unknown, { auth = true }: { auth?: boolean } = {}) {
  return new Request("http://localhost/api/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer app-session-token" } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/events", () => {
  beforeEach(() => {
    mockVerifyAccessToken.mockReset().mockResolvedValue({
      authUserId: "auth-user-1",
      email: "student@example.com",
    });
    mockUserFindUnique.mockReset().mockResolvedValue(authUserRow());
    mockUsageEventCreate.mockReset();
    mockUsageEventCreate.mockResolvedValue({});
  });

  it("stores the event with the session's user id and returns 201", async () => {
    const response = await POST(eventRequest({ event: "today.mark_done", client: "web" }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockUsageEventCreate).toHaveBeenCalledWith({
      data: { userId: "user-1", event: "today.mark_done", client: "web" },
    });
  });

  it("accepts events from the iOS app", async () => {
    const response = await POST(eventRequest({ event: "app_open", client: "app" }));

    expect(response.status).toBe(201);
    expect(mockUsageEventCreate).toHaveBeenCalledWith({
      data: { userId: "user-1", event: "app_open", client: "app" },
    });
  });

  it("returns 401 without a valid session and stores nothing", async () => {
    const response = await POST(eventRequest({ event: "app_open", client: "web" }, { auth: false }));

    expect(response.status).toBe(401);
    expect(mockUsageEventCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{oops"],
    ["an array", ["app_open"]],
    ["a missing event", { client: "web" }],
    ["a missing client", { event: "app_open" }],
    ["an unknown client", { event: "app_open", client: "android" }],
    ["free text as the event", { event: "Opened CS 490 grades for jane@njit.edu", client: "web" }],
    ["an uppercase event", { event: "AppOpen", client: "web" }],
    ["an event that is too long", { event: `a${"b".repeat(64)}`, client: "web" }],
    ["extra fields", { event: "app_open", client: "web", email: "jane@njit.edu" }],
  ])("returns 400 for %s", async (_label, body) => {
    const response = await POST(eventRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid body" });
    expect(mockUsageEventCreate).not.toHaveBeenCalled();
  });
});
