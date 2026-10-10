import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFindUnique, mockUserUpdate } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    get canvasTokenEncryptionKey() {
      return Buffer.alloc(32).toString("base64");
    },
    get canvasBaseUrl() {
      return "https://canvas.example.edu";
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      update: mockUserUpdate,
    },
  },
}));

import { clearCanvasToken, getCanvasStatus, getCanvasToken, saveCanvasToken } from "./canvas-credentials";

function connectedRow() {
  const cipher = Buffer.from("not-the-token").toString("base64");
  return {
    canvasTokenCipher: cipher,
    canvasTokenIv: Buffer.from("0".repeat(12)).toString("base64"),
    canvasTokenTag: Buffer.from("0".repeat(16)).toString("base64"),
    canvasBaseUrl: "https://canvas.example.edu",
  };
}

describe("canvas-credentials", () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset();
  });

  it("returns null when unconnected", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    await expect(getCanvasToken("user-1")).resolves.toBeNull();
  });

  it("returns null when decryption fails rather than throwing", async () => {
    mockUserFindUnique.mockResolvedValue(connectedRow());
    await expect(getCanvasToken("user-1")).resolves.toBeNull();
    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          canvasTokenCipher: true,
          canvasTokenIv: true,
          canvasTokenTag: true,
          canvasBaseUrl: true,
        }),
      })
    );
  });

  it("round-trips a saved token back out", async () => {
    mockUserUpdate.mockResolvedValue({});
    await saveCanvasToken("user-1", "https://canvas.example.edu", "canvas-token-value");
    const written = mockUserUpdate.mock.calls[0][0].data;
    mockUserFindUnique.mockResolvedValue({
      canvasTokenCipher: written.canvasTokenCipher,
      canvasTokenIv: written.canvasTokenIv,
      canvasTokenTag: written.canvasTokenTag,
      canvasBaseUrl: written.canvasBaseUrl,
    });
    await expect(getCanvasToken("user-1")).resolves.toEqual({
      baseUrl: "https://canvas.example.edu",
      token: "canvas-token-value",
    });
  });

  it("getStatus never includes a token key", async () => {
    mockUserFindUnique.mockResolvedValue({
      canvasTokenCipher: "cipher",
      canvasTokenIv: "iv",
      canvasTokenTag: "tag",
      canvasBaseUrl: "https://canvas.example.edu",
      canvasCheckedAt: new Date(),
    });
    const status = await getCanvasStatus("user-1");
    expect(Object.keys(status)).toEqual(["connected", "baseUrl", "checkedAt"]);
    expect(status.connected).toBe(true);
  });

  it("getStatus reports disconnected when a credential part is missing", async () => {
    mockUserFindUnique.mockResolvedValue({
      canvasTokenCipher: "cipher",
      canvasTokenIv: null,
      canvasTokenTag: "tag",
      canvasBaseUrl: "https://canvas.example.edu",
      canvasCheckedAt: new Date(),
    });
    await expect(getCanvasStatus("user-1")).resolves.toMatchObject({ connected: false });
  });

  it("saveCanvasToken writes all five columns", async () => {
    mockUserUpdate.mockResolvedValue({});
    await saveCanvasToken("user-1", "https://canvas.example.edu", "canvas-token-123");
    const data = mockUserUpdate.mock.calls[0][0].data;
    expect(data.canvasTokenCipher).toBeTruthy();
    expect(JSON.stringify(data)).not.toContain("canvas-token-123");
    expect(data.canvasBaseUrl).toBe("https://canvas.example.edu");
    expect(data.canvasCheckedAt).toBeInstanceOf(Date);
  });

  it("clearCanvasToken nulls all five columns", async () => {
    mockUserUpdate.mockResolvedValue({});
    await clearCanvasToken("user-1");
    const data = mockUserUpdate.mock.calls[0][0].data;
    expect(data).toEqual({
      canvasTokenCipher: null,
      canvasTokenIv: null,
      canvasTokenTag: null,
      canvasBaseUrl: null,
      canvasCheckedAt: null,
    });
  });
});
