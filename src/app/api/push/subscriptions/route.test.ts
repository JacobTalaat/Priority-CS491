import { createECDH, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockVerifyAccessToken: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockPushFindUnique: vi.fn(),
  mockPushUpsert: vi.fn(),
  mockPushFindMany: vi.fn(),
  mockPushDeleteMany: vi.fn(),
  mockTransaction: vi.fn(),
  mockExecuteRaw: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mocks.mockVerifyAccessToken,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.mockUserFindUnique },
    pushSubscription: {
      findUnique: mocks.mockPushFindUnique,
      upsert: mocks.mockPushUpsert,
      findMany: mocks.mockPushFindMany,
      deleteMany: mocks.mockPushDeleteMany,
    },
    $transaction: mocks.mockTransaction,
    $executeRaw: mocks.mockExecuteRaw,
  },
}));

import { DELETE, POST } from "./route";

// Real browser-style key material: p256dh is an uncompressed P-256 point the
// push service itself would accept, auth is exactly 16 random bytes.
const KEYS = (() => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey("base64url"), auth: randomBytes(16).toString("base64url") };
})();

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const INVALID_SUBSCRIPTION_ERROR =
  "Send endpoint as the https push service URL your browser gave you (at most 1000 characters), keys.p256dh as its uncompressed P-256 public key, and keys.auth as its 16-byte secret.";
const UNALLOWED_ENDPOINT_ERROR =
  "Only Priority's supported push services (Google, Mozilla, Apple or Windows) can be used.";
const TAKEOVER_CONFLICT_ERROR =
  "This browser subscription belongs to another account. Turn notifications off there first.";

function request(method: string, rawBody: string, withSession = true, userAgent?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (withSession) {
    headers.set("Authorization", "Bearer app-token");
  }
  if (userAgent) {
    headers.set("User-Agent", userAgent);
  }
  return new Request("http://localhost/api/push/subscriptions", { method, headers, body: rawBody });
}

function validRaw(endpoint = ENDPOINT): string {
  return JSON.stringify({ endpoint, keys: { p256dh: KEYS.p256dh, auth: KEYS.auth } });
}

// Runs the route's transaction callback against a fake tx wired to the mocks,
// the way the route expects prisma.$transaction to behave.
beforeEach(() => {
  mocks.mockVerifyAccessToken.mockReset().mockResolvedValue({
    authUserId: "auth-user-1",
    email: "student@example.com",
  });
  mocks.mockUserFindUnique
    .mockReset()
    .mockResolvedValue({ id: "user-1", email: "student@example.com" });
  mocks.mockPushFindUnique.mockReset().mockResolvedValue(null);
  mocks.mockPushUpsert.mockReset().mockResolvedValue({ id: "kept" });
  mocks.mockPushFindMany.mockReset().mockResolvedValue([{ id: "kept" }]);
  mocks.mockPushDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  mocks.mockExecuteRaw.mockReset().mockResolvedValue(undefined);
  mocks.mockTransaction
    .mockReset()
    .mockImplementation(async (callback: (tx: unknown) => unknown) => {
      const tx = {
        $executeRaw: mocks.mockExecuteRaw,
        pushSubscription: {
          upsert: mocks.mockPushUpsert,
          findMany: mocks.mockPushFindMany,
          deleteMany: mocks.mockPushDeleteMany,
        },
      };
      return callback(tx);
    });
});

describe("POST /api/push/subscriptions", () => {
  it("returns 401 without a bearer token and saves nothing", async () => {
    const res = await POST(request("POST", validRaw(), false));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.mockPushUpsert).not.toHaveBeenCalled();
  });

  it.each([
    "not json",
    '{"endpoint":"https://fcm.googleapis.com/fcm/send/abc","keys":{"p256dh"',
    "",
    "[]",
  ])("rejects the malformed body %s", async (rawBody) => {
    const res = await POST(request("POST", rawBody));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: INVALID_SUBSCRIPTION_ERROR });
    expect(mocks.mockPushUpsert).not.toHaveBeenCalled();
  });

  it("rejects a valid object whose endpoint exceeds 1000 characters", async () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${"a".repeat(1000)}`;
    const res = await POST(
      request("POST", JSON.stringify({ endpoint, keys: { p256dh: KEYS.p256dh, auth: KEYS.auth } })),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: INVALID_SUBSCRIPTION_ERROR });
    expect(mocks.mockPushUpsert).not.toHaveBeenCalled();
  });

  it("rejects a body over 4 KB even when its content would be valid", async () => {
    const endpoint = `${ENDPOINT}-${"a".repeat(5000)}`;
    const res = await POST(request("POST", JSON.stringify({ endpoint, keys: KEYS })));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: INVALID_SUBSCRIPTION_ERROR });
    expect(mocks.mockPushUpsert).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { endpoint: 7, keys: KEYS },
    { keys: KEYS },
    { endpoint: "http://fcm.googleapis.com/fcm/send/abc", keys: KEYS },
    { endpoint: "not a url", keys: KEYS },
    { endpoint: ENDPOINT, keys: { p256dh: KEYS.p256dh, auth: KEYS.auth, extra: 1 } },
    { endpoint: ENDPOINT, keys: { p256dh: KEYS.p256dh } },
    { endpoint: ENDPOINT, keys: KEYS, extra: 1 },
  ])("rejects the invalid body %p", async (body) => {
    const res = await POST(request("POST", JSON.stringify(body)));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: INVALID_SUBSCRIPTION_ERROR });
    expect(mocks.mockPushUpsert).not.toHaveBeenCalled();
  });

  it("gives an https endpoint outside the allowlist its own message", async () => {
    const res = await POST(request("POST", JSON.stringify({ endpoint: "https://evil.example.com/abc", keys: KEYS })));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: UNALLOWED_ENDPOINT_ERROR });
    expect(mocks.mockPushUpsert).not.toHaveBeenCalled();
  });

  it("rejects a p256dh that is not a valid P-256 point", async () => {
    const res = await POST(
      request(
        "POST",
        JSON.stringify({
          endpoint: ENDPOINT,
          keys: { p256dh: Buffer.alloc(65, 3).toString("base64url"), auth: KEYS.auth },
        }),
      ),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: INVALID_SUBSCRIPTION_ERROR });
    expect(mocks.mockPushUpsert).not.toHaveBeenCalled();
  });

  it("rejects a p256dh whose first byte is not 0x04", async () => {
    const bytes = Buffer.alloc(65, 3);
    bytes[0] = 0x02;
    const res = await POST(
      request("POST", JSON.stringify({ endpoint: ENDPOINT, keys: { p256dh: bytes.toString("base64url"), auth: KEYS.auth } })),
    );
    expect(res.status).toBe(400);
    expect(mocks.mockPushUpsert).not.toHaveBeenCalled();
  });

  it("rejects an auth secret that is not exactly 16 bytes", async () => {
    const wrongAuth = randomBytes(15).toString("base64url");
    const res = await POST(
      request("POST", JSON.stringify({ endpoint: ENDPOINT, keys: { p256dh: KEYS.p256dh, auth: wrongAuth } })),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: INVALID_SUBSCRIPTION_ERROR });
    expect(mocks.mockPushUpsert).not.toHaveBeenCalled();
  });

  it("saves the subscription for the authenticated user with the request's user agent", async () => {
    const res = await POST(request("POST", validRaw(), true, "Safari/605"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ subscribed: true });
    const save = mocks.mockPushUpsert.mock.calls[0][0];
    expect(save.where).toEqual({ endpoint: ENDPOINT });
    expect(save.create).toEqual({
      userId: "user-1",
      endpoint: ENDPOINT,
      p256dh: KEYS.p256dh,
      auth: KEYS.auth,
      userAgent: "Safari/605",
    });
    expect(save.update).toMatchObject({ userId: "user-1", failureCount: 0 });
  });

  it("moves an endpoint when the stored keys prove the same browser subscription", async () => {
    mocks.mockPushFindUnique.mockResolvedValueOnce({
      id: "row-old",
      userId: "user-2",
      p256dh: KEYS.p256dh,
      auth: KEYS.auth,
    });
    const res = await POST(request("POST", validRaw()));
    expect(res.status).toBe(200);
    expect(mocks.mockPushUpsert.mock.calls[0][0].update.userId).toBe("user-1");
  });

  it("returns 409 when an endpoint with different keys belongs to another account", async () => {
    mocks.mockPushFindUnique.mockResolvedValueOnce({
      id: "row-old",
      userId: "user-2",
      p256dh: Buffer.from("not-the-same-browser-keys").toString("base64url"),
      auth: KEYS.auth,
    });
    const res = await POST(request("POST", validRaw()));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: TAKEOVER_CONFLICT_ERROR });
    expect(mocks.mockPushUpsert).not.toHaveBeenCalled();
  });

  it("prunes to the cap inside a per-user transaction after an upsert", async () => {
    mocks.mockPushFindMany.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => ({ id: `row-${index}` })),
    );

    const res = await POST(request("POST", validRaw()));

    expect(res.status).toBe(200);
    expect(mocks.mockTransaction).toHaveBeenCalled();
    expect(mocks.mockExecuteRaw).toHaveBeenCalled();
    expect(mocks.mockPushFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: [{ lastSuccessAt: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    expect(mocks.mockPushDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["row-0"] }, userId: "user-1" },
    });
  });

  it("never prunes the row the browser just registered", async () => {
    // Exactly at the cap plus the new row, and the new row carries the oldest
    // createdAt among "old-9"...
    mocks.mockPushFindMany.mockResolvedValue([
      { id: "old-0" },
      ...Array.from({ length: 9 }, (_, index) => ({ id: `old-${index + 1}` })),
      { id: "kept" },
    ]);

    expect((await POST(request("POST", validRaw()))).status).toBe(200);
    const deletedIds = mocks.mockPushDeleteMany.mock.calls[0][0].where.id.in;
    expect(deletedIds).toEqual(["old-0"]);
    expect(deletedIds).not.toContain("kept");
  });
});

describe("DELETE /api/push/subscriptions", () => {
  it("returns 401 without a bearer token and removes nothing", async () => {
    const res = await DELETE(request("DELETE", JSON.stringify({ endpoint: ENDPOINT }), false));
    expect(res.status).toBe(401);
    expect(mocks.mockPushDeleteMany).not.toHaveBeenCalled();
  });

  it.each(["not json", "{}", JSON.stringify({ endpoint: "" }), JSON.stringify({ endpoint: 400 }), JSON.stringify({ endpoint: ["array"] })])(
    "rejects the invalid endpoint body %s",
    async (rawBody) => {
      const res = await DELETE(request("DELETE", rawBody));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toHaveProperty("error");
      expect(mocks.mockPushDeleteMany).not.toHaveBeenCalled();
    },
  );

  it("removes only the caller's own subscription for that endpoint", async () => {
    mocks.mockPushDeleteMany.mockResolvedValueOnce({ count: 1 });
    const res = await DELETE(request("DELETE", JSON.stringify({ endpoint: ENDPOINT })));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ removed: true });
    expect(mocks.mockPushDeleteMany).toHaveBeenCalledWith({
      where: { endpoint: ENDPOINT, userId: "user-1" },
    });
  });

  it("reports removed false when the endpoint belongs to nobody", async () => {
    mocks.mockPushDeleteMany.mockResolvedValueOnce({ count: 0 });
    const res = await DELETE(request("DELETE", JSON.stringify({ endpoint: ENDPOINT })));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ removed: false });
  });
});
