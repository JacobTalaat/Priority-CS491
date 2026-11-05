import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSessionFindUnique,
  mockTransaction,
  mockTxDeleteMany,
  mockTxUpsert,
  mockTxFindMany,
  mockDeviceDeleteMany,
} = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxDeleteMany: vi.fn(),
  mockTxUpsert: vi.fn(),
  mockTxFindMany: vi.fn(),
  mockDeviceDeleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    deviceToken: { deleteMany: mockDeviceDeleteMany },
    $transaction: mockTransaction,
  },
}));

import { DELETE, POST } from "./route";

const TOKEN = "a".repeat(64);
const UPPER_TOKEN = "A".repeat(64);
const SHORT_TOKEN = "a".repeat(31);
const ODD_LENGTH_TOKEN = "a".repeat(33);
const NON_HEX_TOKEN = "g".repeat(64);
const DEVICE_ID = "123e4567-e89b-12d3-a456-426614174000";
const SECOND_DEVICE_ID = "223e4567-e89b-12d3-a456-426614174000";

function request(method: string, body: unknown, withSession = true): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (withSession) {
    headers.set("Authorization", "Bearer app-session-token");
  }
  return new Request("http://localhost/api/devices", {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

function rawRequest(method: string, body: string): Request {
  return new Request("http://localhost/api/devices", {
    method,
    headers: { Authorization: "Bearer app-session-token", "Content-Type": "application/json" },
    body,
  });
}

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

function transactionImplementation() {
  return async (callback: (tx: unknown) => Promise<unknown>) => {
    return callback({
      deviceToken: {
        deleteMany: mockTxDeleteMany,
        upsert: mockTxUpsert,
        findMany: mockTxFindMany,
      },
    });
  };
}

describe("POST /api/devices", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
    mockTransaction.mockReset();
    mockTxDeleteMany.mockReset();
    mockTxUpsert.mockReset();
    mockTxFindMany.mockReset();
    mockTransaction.mockImplementation(transactionImplementation());
    mockTxDeleteMany.mockResolvedValue({ count: 1 });
    mockTxUpsert.mockResolvedValue({});
    mockTxFindMany.mockResolvedValue([]);
  });

  it("returns 401 without a session", async () => {
    mockSessionFindUnique.mockResolvedValue(null);
    const res = await POST(request("POST", { token: TOKEN, platform: "ios", deviceId: DEVICE_ID }, false));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 with a plain message for invalid JSON", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    const res = await POST(rawRequest("POST", "not json"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body." });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for tokens that are too short, odd-length, or not hex", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    for (const token of [SHORT_TOKEN, ODD_LENGTH_TOKEN, NON_HEX_TOKEN, 123, null, UPPER_TOKEN.slice(0, 200) + "zz"]) {
      const res = await POST(request("POST", { token, platform: "ios", deviceId: DEVICE_ID }));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: "Device token must be a hex string of 32 to 400 characters.",
      });
    }
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for a platform other than ios", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    const res = await POST(request("POST", { token: TOKEN, platform: "android", deviceId: DEVICE_ID }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Only the ios platform is supported." });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for a bad deviceId", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    for (const deviceId of ["not-a-uuid", "123e4567e89b12d3a456426614174000", 123, null]) {
      const res = await POST(request("POST", { token: TOKEN, platform: "ios", deviceId }));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "deviceId must be a UUID." });
    }
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("keeps the student's other devices when registering a second one", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    await POST(request("POST", { token: TOKEN, platform: "ios", deviceId: DEVICE_ID }));
    await POST(request("POST", { token: "b".repeat(64), platform: "ios", deviceId: SECOND_DEVICE_ID }));
    // Only the row that holds the new token is deleted, never the other rows.
    expect(mockTxDeleteMany).toHaveBeenNthCalledWith(1, { where: { token: TOKEN } });
    expect(mockTxDeleteMany).toHaveBeenNthCalledWith(2, { where: { token: "b".repeat(64) } });
    const [firstUpsert, secondUpsert] = mockTxUpsert.mock.calls.map((call) => call[0]);
    expect(firstUpsert.create.deviceId).toBe(DEVICE_ID);
    expect(secondUpsert.create.deviceId).toBe(SECOND_DEVICE_ID);
  });

  it("replaces the token when the same device registers again", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    await POST(request("POST", { token: TOKEN, platform: "ios", deviceId: DEVICE_ID }));
    const newToken = "c".repeat(64);
    await POST(request("POST", { token: newToken, platform: "ios", deviceId: DEVICE_ID }));
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    const [firstUpsert, secondUpsert] = mockTxUpsert.mock.calls.map((call) => call[0]);
    expect(firstUpsert.create.token).toBe(TOKEN);
    expect(secondUpsert.update.token).toBe(newToken);
    expect(secondUpsert.where.userId_deviceId).toEqual({
      userId: "user-1",
      deviceId: DEVICE_ID,
    });
  });

  it("pulls a token away from the other account that still holds it", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    const res = await POST(request("POST", { token: TOKEN, platform: "ios", deviceId: DEVICE_ID }));
    expect(res.status).toBe(200);
    // The token delete is not scoped to a user, so a row belonging to any
    // other account with this token is removed first.
    expect(mockTxDeleteMany).toHaveBeenCalledWith({ where: { token: TOKEN } });
  });

  it("evicts the oldest device row when a student registers an eleventh device", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockTxFindMany.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => ({ id: `row-${index}` }))
    );
    const res = await POST(request("POST", { token: TOKEN, platform: "ios", deviceId: DEVICE_ID }));
    expect(res.status).toBe(200);
    // findMany gets the rows newest-first, so the last id is the oldest device.
    expect(mockTxFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    expect(mockTxDeleteMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ["row-10"] } },
    });
  });

  it("does not evict anything while the student is within the cap", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockTxFindMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({ id: `row-${index}` }))
    );
    await POST(request("POST", { token: TOKEN, platform: "ios", deviceId: DEVICE_ID }));
    expect(mockTxDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("accepts uppercase input and stores everything lowercased", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    const deviceId = DEVICE_ID.toUpperCase();
    const res = await POST(request("POST", { token: UPPER_TOKEN, platform: "ios", deviceId }));
    expect(res.status).toBe(200);
    const upsert = mockTxUpsert.mock.calls[0][0];
    expect(upsert.create.token).toBe(TOKEN);
    expect(upsert.create.deviceId).toBe(DEVICE_ID);
    expect(JSON.stringify(mockTxDeleteMany.mock.calls)).not.toContain("A".repeat(32));
  });

  it("retries the transaction once when a write conflict hits, then succeeds", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockTransaction
      .mockImplementationOnce(async () => {
        throw { code: "P2034" };
      })
      .mockImplementation(transactionImplementation());
    const res = await POST(request("POST", { token: TOKEN, platform: "ios", deviceId: DEVICE_ID }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ registered: true });
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(mockTxUpsert).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when the transaction keeps hitting write conflicts", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockTransaction.mockImplementation(async () => {
      throw { code: "P2034" };
    });
    const res = await POST(request("POST", { token: TOKEN, platform: "ios", deviceId: DEVICE_ID }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "Couldn't register this device right now. Try again.",
    });
    expect(mockTransaction).toHaveBeenCalledTimes(3);
    expect(mockTxUpsert).not.toHaveBeenCalled();
  });

  it("does not retry or hide a real database failure", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockTransaction.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    await expect(
      POST(request("POST", { token: TOKEN, platform: "ios", deviceId: DEVICE_ID })),
    ).rejects.toThrow("connection refused");
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /api/devices", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset();
    mockDeviceDeleteMany.mockReset();
  });

  it("returns 401 without a session", async () => {
    mockSessionFindUnique.mockResolvedValue(null);
    const res = await DELETE(request("DELETE", { token: TOKEN }, false));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockDeviceDeleteMany).not.toHaveBeenCalled();
  });

  it("returns 400 with a plain message for invalid JSON", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    const res = await DELETE(rawRequest("DELETE", "{{"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid JSON body." });
    expect(mockDeviceDeleteMany).not.toHaveBeenCalled();
  });

  it("validates the token like POST does, after trimming it", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    const res = await DELETE(request("DELETE", { token: ODD_LENGTH_TOKEN }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Device token must be a hex string of 32 to 400 characters.",
    });
    expect(mockDeviceDeleteMany).not.toHaveBeenCalled();

    mockDeviceDeleteMany.mockResolvedValue({ count: 1 });
    const trimmed = await DELETE(request("DELETE", { token: `\n ${UPPER_TOKEN} ` }));
    expect(trimmed.status).toBe(200);
    expect(mockDeviceDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", token: TOKEN },
    });
  });

  it("removes only a token that belongs to the student", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockDeviceDeleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(request("DELETE", { token: TOKEN }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ removed: true });
    expect(mockDeviceDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", token: TOKEN },
    });
  });

  it("reports removed false when the token belongs to nobody or another user", async () => {
    mockSessionFindUnique.mockResolvedValue(sessionRow());
    mockDeviceDeleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(request("DELETE", { token: TOKEN }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ removed: false });
  });
});
