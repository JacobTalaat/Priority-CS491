import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserFindUnique, mockUserUpdate } = vi.hoisted(() => ({
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mockUserFindUnique, update: mockUserUpdate } },
}));

vi.mock("@/lib/env", () => ({
  env: {
    get canvasTokenEncryptionKey() {
      return Buffer.alloc(32, 1).toString("base64");
    },
    get canvasBaseUrl() {
      return "https://canvas.example.edu";
    },
  },
}));

import {
  clearCalendarFeed,
  getCalendarFeedStatus,
  getCalendarFeedUrl,
  saveCalendarFeed,
} from "./calendar-feed-credentials";

const USER_ID = "user-1";
const FEED_URL = "https://canvas.example.edu/feeds/calendar.ics?private=token";

describe("calendar feed credentials", () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockUserUpdate.mockReset().mockResolvedValue({});
  });

  it("encrypts the private URL before storing it", async () => {
    await saveCalendarFeed(USER_ID, FEED_URL);
    const update = mockUserUpdate.mock.calls[0][0];
    expect(update.where).toEqual({ id: USER_ID });
    expect(update.data).toEqual({
      canvasCalendarFeedCipher: expect.any(String),
      canvasCalendarFeedIv: expect.any(String),
      canvasCalendarFeedTag: expect.any(String),
    });
    expect(JSON.stringify(update)).not.toContain(FEED_URL);
  });

  it("decrypts the saved URL for sync and reports only the configured state", async () => {
    const saved: Record<string, string> = {};
    mockUserUpdate.mockImplementation(({ data }) => {
      Object.assign(saved, data);
      return {};
    });
    await saveCalendarFeed(USER_ID, FEED_URL);
    mockUserFindUnique.mockResolvedValue(saved);

    await expect(getCalendarFeedUrl(USER_ID)).resolves.toBe(FEED_URL);
    await expect(getCalendarFeedStatus(USER_ID)).resolves.toEqual({ configured: true });
  });

  it("returns null for an unset feed and clears all encrypted parts", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    await expect(getCalendarFeedUrl(USER_ID)).resolves.toBeNull();
    await expect(getCalendarFeedStatus(USER_ID)).resolves.toEqual({ configured: false });

    await clearCalendarFeed(USER_ID);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: {
        canvasCalendarFeedCipher: null,
        canvasCalendarFeedIv: null,
        canvasCalendarFeedTag: null,
      },
    });
  });

  it("reports corrupted ciphertext instead of treating it as an absent feed", async () => {
    mockUserFindUnique.mockResolvedValue({
      canvasCalendarFeedCipher: "not-ciphertext",
      canvasCalendarFeedIv: "iv",
      canvasCalendarFeedTag: "tag",
    });
    await expect(getCalendarFeedUrl(USER_ID)).rejects.toThrow("could not be decrypted");
  });
});
