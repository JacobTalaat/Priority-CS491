import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TEST_SENDS, resetTestSendLimitForTests } from "@/lib/push-test-limit";

const mocks = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockPushFindMany: vi.fn(),
  mockSendPush: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mocks.mockVerifyAccessToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.mockUserFindUnique },
    pushSubscription: { findMany: mocks.mockPushFindMany },
  },
}));

vi.mock("@/lib/web-push", () => ({
  sendPush: mocks.mockSendPush,
}));

import { POST } from "./route";

function request(withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer app-token");
  }
  return new Request("http://localhost/api/push/test", { method: "POST", headers });
}

function subscription(index: string) {
  return { id: index, endpoint: `https://push.example/${index}`, p256dh: "k", auth: "a" };
}

describe("POST /api/push/test", () => {
  beforeEach(() => {
    resetTestSendLimitForTests();
    mocks.mockVerifyAccessToken.mockReset().mockResolvedValue({
      authUserId: "auth-user-1",
      email: "student@example.com",
    });
    mocks.mockUserFindUnique
      .mockReset()
      .mockResolvedValue({ id: "user-1", email: "student@example.com" });
    mocks.mockPushFindMany
      .mockReset()
      .mockResolvedValue([subscription("sub-1"), subscription("sub-2")]);
    mocks.mockSendPush
      .mockReset()
      .mockResolvedValue("sent");
  });

  it("returns 401 without a bearer token and sends nothing", async () => {
    const res = await POST(request(false));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.mockPushFindMany).not.toHaveBeenCalled();
    expect(mocks.mockSendPush).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the caller's subscriptions", async () => {
    await POST(request());
    expect(mocks.mockPushFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "asc" },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  });

  it("sends one push per subscription with the fixed test message", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 2, failed: 0, removed: 0 });
    expect(mocks.mockSendPush).toHaveBeenCalledTimes(2);
    expect(mocks.mockSendPush).toHaveBeenNthCalledWith(2, subscription("sub-2"), {
      title: "Priority",
      body: "Notifications are on.",
      url: "/today",
    });
  });

  it("counts failures and removals separately", async () => {
    mocks.mockSendPush.mockImplementation(async (target: { id: string }) => {
      if (target.id === "sub-1") {
        return "removed";
      }
      return "failed";
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 0, failed: 1, removed: 1 });
  });

  it("finishes the whole batch even when one send explodes", async () => {
    mocks.mockSendPush
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("sent");
    const res = await POST(request());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 1, failed: 1, removed: 0 });
  });

  it("returns 404 when the caller has no subscriptions", async () => {
    mocks.mockPushFindMany.mockResolvedValue([]);
    const res = await POST(request());
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toHaveProperty("error");
    expect(mocks.mockSendPush).not.toHaveBeenCalled();
  });

  it("a check without subscriptions refunds the rate limit", async () => {
    mocks.mockPushFindMany.mockResolvedValue([]);
    for (let index = 0; index < 5; index += 1) {
      expect((await POST(request())).status).toBe(404);
    }
    mocks.mockPushFindMany.mockResolvedValue([subscription("sub-1")]);
    const res = await POST(request());
    expect(res.status).toBe(200);
  });

  it("limits the caller to three sends per window", async () => {
    for (let index = 0; index < MAX_TEST_SENDS; index += 1) {
      expect((await POST(request())).status).toBe(200);
    }
    const res = await POST(request());
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toHaveProperty("error");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("limits one account without affecting another", async () => {
    for (let index = 0; index < MAX_TEST_SENDS; index += 1) {
      await POST(request());
    }
    mocks.mockVerifyAccessToken.mockResolvedValue({
      authUserId: "auth-user-2",
      email: "other@example.com",
    });
    mocks.mockUserFindUnique.mockResolvedValue({
      id: "user-2",
      email: "other@example.com",
    });
    const other = await POST(request());
    expect(other.status).toBe(200);
  });

  it("with one slot left, two parallel requests yield one 200 and one 429", async () => {
    // Burn two of the three slots, then launch the last two requests against
    // the single remaining one; the reservation is synchronous, so only one
    // request may reserve it.
    await POST(request());
    await POST(request());
    const [first, second] = await Promise.all([POST(request()), POST(request())]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 429]);
  });
});
