import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPushFindMany, mockSendPush } = vi.hoisted(() => ({
  mockPushFindMany: vi.fn(),
  mockSendPush: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: { findMany: mockPushFindMany },
  },
}));

vi.mock("@/lib/web-push", () => ({
  sendPush: mockSendPush,
}));

import { sendToUser } from "./notify";

const MESSAGE = { title: "Grade posted", body: "Grade posted: Lab (CS 101) — 8/10.", url: "/classes" };

function subscription(id: string) {
  return { id, endpoint: `https://push.example/${id}`, p256dh: "k", auth: "a" };
}

describe("sendToUser", () => {
  beforeEach(() => {
    mockPushFindMany.mockReset();
    mockPushFindMany.mockResolvedValue([]);
    mockSendPush.mockReset();
    mockSendPush.mockResolvedValue("sent");
  });

  it("sends to every saved subscription of the user and returns all zeros when there are none", async () => {
    expect(await sendToUser("user-1", MESSAGE)).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(mockSendPush).not.toHaveBeenCalled();
    const subs = [subscription("sub-1"), subscription("sub-2"), subscription("sub-3")];
    mockPushFindMany.mockResolvedValue(subs);
    expect(await sendToUser("user-1", MESSAGE)).toEqual({ sent: 3, failed: 0, removed: 0 });
    for (const sub of subs) {
      expect(mockSendPush).toHaveBeenCalledWith(sub, MESSAGE, ...([] as unknown[]));
    }
    expect(mockSendPush.mock.calls.map((call) => (call[0] as { id: string }).id)).toEqual([
      "sub-1",
      "sub-2",
      "sub-3",
    ]);
  });

  it("passes an optional TTL through to every send", async () => {
    const subs = [subscription("sub-1"), subscription("sub-2")];
    mockPushFindMany.mockResolvedValue(subs);
    await sendToUser("user-1", MESSAGE, { ttlSeconds: 7200 });
    for (const sub of subs) {
      expect(mockSendPush).toHaveBeenCalledWith(sub, MESSAGE, { ttlSeconds: 7200 });
    }
  });

  it("scopes the lookup to the user and loads only the fields a send needs", async () => {
    await sendToUser("user-1", MESSAGE);
    expect(mockPushFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  });

  it("counts sent, failed, and removed outcomes separately", async () => {
    mockPushFindMany.mockResolvedValue([
      subscription("sub-1"),
      subscription("sub-2"),
      subscription("sub-3"),
    ]);
    mockSendPush.mockImplementation(async (target: { id: string }) => {
      if (target.id === "sub-1") {
        return "sent";
      }
      if (target.id === "sub-2") {
        return "removed";
      }
      return "failed";
    });
    expect(await sendToUser("user-1", MESSAGE)).toEqual({ sent: 1, failed: 1, removed: 1 });
  });

  it("a send that throws is a failure without losing the other counts", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPushFindMany.mockResolvedValue([subscription("sub-1"), subscription("sub-2")]);
    mockSendPush
      .mockRejectedValueOnce(new Error("boom: https://push.example/sub-1 leaked"))
      .mockResolvedValueOnce("sent");
    expect(await sendToUser("user-1", MESSAGE)).toEqual({ sent: 1, failed: 1, removed: 0 });
    const logged = errorSpy.mock.calls.filter((call) =>
      call.includes("Web push send failed."),
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]).toEqual(["Web push send failed."]);
    errorSpy.mockRestore();
  });
});
