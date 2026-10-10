import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSessionFindUnique, mockFeedStatus, mockSaveFeed, mockClearFeed } = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockFeedStatus: vi.fn(),
  mockSaveFeed: vi.fn(),
  mockClearFeed: vi.fn(),
}));

vi.mock("@/lib/calendar-feed-credentials", () => ({
  getCalendarFeedStatus: mockFeedStatus,
  saveCalendarFeed: mockSaveFeed,
  clearCalendarFeed: mockClearFeed,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { session: { findUnique: mockSessionFindUnique } },
}));

import { DELETE, GET, POST } from "./route";

function request(method: string, body?: unknown, withSession = true) {
  const headers = new Headers();
  if (withSession) {
    headers.set("Authorization", "Bearer app-token");
  }
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  return new Request("http://localhost/api/canvas/calendar-feed", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function sessionRow() {
  return {
    id: "session-1",
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { id: "user-1", email: "student@example.com" },
  };
}

describe("/api/canvas/calendar-feed", () => {
  beforeEach(() => {
    mockSessionFindUnique.mockReset().mockResolvedValue(sessionRow());
    mockFeedStatus.mockReset().mockResolvedValue({ configured: false });
    mockSaveFeed.mockReset().mockResolvedValue(undefined);
    mockClearFeed.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR", { status: 200 }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves a normalized feed URL only for the authenticated user", async () => {
    const response = await POST(
      request("POST", { feedUrl: " https://canvas.example.edu/feeds/calendar.ics " }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ configured: true });
    expect(mockSaveFeed).toHaveBeenCalledWith("user-1", "https://canvas.example.edu/feeds/calendar.ics");
  });

  it("rejects invalid or insecure feed links without saving them", async () => {
    const response = await POST(request("POST", { feedUrl: "http://canvas.example.edu/feed.ics" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Use a public HTTPS Canvas calendar feed link.",
    });
    expect(mockSaveFeed).not.toHaveBeenCalled();
  });

  it("returns a clear error and does not save an unavailable feed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
    const response = await POST(request("POST", { feedUrl: "https://canvas.example.edu/feed.ics" }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Could not read the Canvas calendar feed. Check that the link is current and publicly accessible.",
    });
    expect(mockSaveFeed).not.toHaveBeenCalled();
  });

  it("reports only whether a feed is configured, never its secret URL", async () => {
    mockFeedStatus.mockResolvedValue({ configured: true });
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ configured: true });
    expect(mockFeedStatus).toHaveBeenCalledWith("user-1");
  });

  it("clears the feed URL for the authenticated user", async () => {
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ configured: false });
    expect(mockClearFeed).toHaveBeenCalledWith("user-1");
  });

  it("requires an app session for all methods", async () => {
    const getResponse = await GET(request("GET", undefined, false));
    const postResponse = await POST(request("POST", { feedUrl: "https://canvas.example.edu/feed.ics" }, false));
    const deleteResponse = await DELETE(request("DELETE", undefined, false));
    expect([getResponse.status, postResponse.status, deleteResponse.status]).toEqual([401, 401, 401]);
    expect(mockFeedStatus).not.toHaveBeenCalled();
    expect(mockSaveFeed).not.toHaveBeenCalled();
    expect(mockClearFeed).not.toHaveBeenCalled();
  });
});
