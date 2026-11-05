import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSendNotification, mockPushUpdate, mockPushDelete } = vi.hoisted(() => ({
  mockSendNotification: vi.fn(),
  mockPushUpdate: vi.fn(),
  mockPushDelete: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: { sendNotification: mockSendNotification },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: { updateMany: mockPushUpdate, deleteMany: mockPushDelete },
  },
}));



// Hoisted: the mocked env factory plus these fixtures must be real P-256 key
// material, formatted as `npx web-push generate-vapid-keys` prints it.
const { KEY_PAIR } = vi.hoisted(() => ({
  KEY_PAIR: {
    publicKey: "BIXOBiIxD-cRzXhz-X4nyxJp_95cZOoctZJMQwfDm9zdeXYVzpvX6C5siLbPr6p-iiF3OFpAKU2rgqAqlqJ9JEw",
    privateKey: "oXFck9hdUqDBzPz9dNkgUsukdR1BTg-3XNNMnXHLtdY",
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    vapidPublicKey: KEY_PAIR.publicKey,
    vapidPrivateKey: KEY_PAIR.privateKey,
    vapidSubject: "mailto:push@example.com",
  },
}));

import { PUSH_TIMEOUT_MS, PUSH_TTL_SECONDS, sendPush } from "./web-push";

const TARGET = {
  id: "sub-1",
  endpoint: "https://fcm.googleapis.com/fcm/send/SUBSCRIPTION-ENDPOINT-must-not-log",
  p256dh: "P256DH-KEY-must-not-log",
  auth: "AUTH-SECRET-must-not-log",
};

const MESSAGE = { title: "Tonight", body: "Start with Lab (CS 341).", url: "/today" };

function pushError(statusCode: number): unknown {
  return Object.assign(new Error("Push service error"), { statusCode });
}

describe("sendPush", () => {
  beforeEach(() => {
    mockSendNotification
      .mockReset()
      .mockResolvedValue(new Response(null, { status: 201 }));
    mockPushUpdate.mockReset().mockResolvedValue(1);
    mockPushDelete.mockReset().mockResolvedValue(1);
  });

  it("sends the message as a JSON payload with the TTL, timeout, and VAPID details", async () => {
    await sendPush(TARGET, MESSAGE);
    expect(mockSendNotification).toHaveBeenCalledWith(
      { endpoint: TARGET.endpoint, keys: { p256dh: TARGET.p256dh, auth: TARGET.auth } },
      JSON.stringify(MESSAGE),
      {
        TTL: PUSH_TTL_SECONDS,
        timeout: PUSH_TIMEOUT_MS,
        vapidDetails: {
          subject: "mailto:push@example.com",
          publicKey: KEY_PAIR.publicKey,
          privateKey: KEY_PAIR.privateKey,
        },
      },
    );
  });

  it("counts a success, resets the failure counter, and stamps lastSuccessAt", async () => {
    const outcome = await sendPush(TARGET, MESSAGE);
    expect(outcome).toBe("sent");
    expect(mockPushUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1", endpoint: TARGET.endpoint },
      data: { failureCount: 0, lastSuccessAt: expect.any(Date) },
    });
    expect(mockPushDelete).not.toHaveBeenCalled();
  });

  it("removes a subscription the push service reports as gone on 404", async () => {
    mockSendNotification.mockRejectedValueOnce(pushError(404));
    const outcome = await sendPush(TARGET, MESSAGE);
    expect(outcome).toBe("removed");
    expect(mockPushDelete).toHaveBeenCalledWith({
      where: { id: "sub-1", endpoint: TARGET.endpoint },
    });
    expect(mockPushUpdate).not.toHaveBeenCalled();
  });

  it("removes a subscription the push service reports as gone on 410", async () => {
    mockSendNotification.mockRejectedValueOnce(pushError(410));
    const outcome = await sendPush(TARGET, MESSAGE);
    expect(outcome).toBe("removed");
    expect(mockPushDelete).toHaveBeenCalledWith({
      where: { id: "sub-1", endpoint: TARGET.endpoint },
    });
  });

  it("keeps the subscription on temporary push service failures and returns failed", async () => {
    for (const statusCode of [401, 403, 429, 500, 503]) {
      mockPushUpdate.mockClear();
      mockPushDelete.mockClear();
      mockSendNotification.mockReset().mockRejectedValueOnce(pushError(statusCode));
      const outcome = await sendPush(TARGET, MESSAGE);
      expect(outcome).toBe("failed");
      expect(mockPushUpdate).toHaveBeenCalledWith({
        where: { id: "sub-1", endpoint: TARGET.endpoint },
        data: { failureCount: { increment: 1 } },
      });
      expect(mockPushDelete).not.toHaveBeenCalled();
    }
  });

  it("counts errors without a status code (network, timeouts, encryption) as failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendNotification.mockRejectedValueOnce(new TypeError("fetch failed"));
    const outcome = await sendPush(TARGET, MESSAGE);
    expect(outcome).toBe("failed");
    expect(mockPushUpdate).toHaveBeenCalled();
    expect(mockPushDelete).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join("\n")).toBe(
      "Web push request could not be built or sent.",
    );
  });

  it("never stops delivering after repeated failures", async () => {
    // Only 404 and 410 delete now; a streak of 500s leaves the subscription in
    // place so the nightly send always gets another try.
    for (let count = 0; count < 6; count += 1) {
      mockSendNotification.mockReset().mockRejectedValueOnce(pushError(500));
      expect(await sendPush(TARGET, MESSAGE)).toBe("failed");
    }
    expect(mockPushDelete).not.toHaveBeenCalled();
  });

  it("a success resets the counter even after earlier failures", async () => {
    mockSendNotification.mockRejectedValueOnce(pushError(500));
    await sendPush(TARGET, MESSAGE);
    const outcome = await sendPush(TARGET, MESSAGE);
    expect(outcome).toBe("sent");
    expect(mockPushUpdate.mock.calls[1][0].data).toEqual({
      failureCount: 0,
      lastSuccessAt: expect.any(Date),
    });
    expect(mockPushDelete).not.toHaveBeenCalled();
  });

  it("deletes and removes a subscription pointing outside the allowlist", async () => {
    expect(await sendPush({ ...TARGET, endpoint: "https://evil.example.com/probe" }, MESSAGE)).toBe(
      "removed",
    );
    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(mockPushDelete).toHaveBeenCalledWith({
      where: { id: "sub-1", endpoint: "https://evil.example.com/probe" },
    });
  });

  it("never throws, not even when the database does", async () => {
    mockSendNotification.mockReset().mockRejectedValueOnce(new Error("Push service error"));
    mockPushUpdate.mockRejectedValueOnce(new Error("db down"));
    mockPushDelete.mockRejectedValueOnce(new Error("db down"));
    expect(await sendPush(TARGET, MESSAGE)).toBe("failed");
  });

  it("never logs the endpoint or the keys", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendNotification.mockRejectedValueOnce(pushError(503));
    await sendPush(TARGET, MESSAGE);
    const logged = errorSpy.mock.calls.flat().join("\n");
    expect(logged).not.toContain(TARGET.endpoint);
    expect(logged).not.toContain(TARGET.p256dh);
    expect(logged).not.toContain(TARGET.auth);
  });
});
