import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CANVAS_URL,
  canvasErrorMessage,
  clearCalendarFeed,
  connectCanvas,
  disconnectCanvas,
  formatLastSynced,
  getCalendarFeedStatus,
  getCanvasStatus,
  getImportedCourses,
  getLastSynced,
  saveCalendarFeed,
  syncNow,
  syncSummary,
  testCanvasConnection,
  validateCanvasForm,
} from "./canvas-client";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: { getItem: () => "app-token" } });
  fetchMock = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateCanvasForm", () => {
  it("accepts a token and the default address", () => {
    expect(validateCanvasForm("1234~abcd", DEFAULT_CANVAS_URL)).toEqual({});
  });

  it("asks for the token when it is blank", () => {
    expect(validateCanvasForm("  ", DEFAULT_CANVAS_URL).token).toBe("Paste your Canvas access token.");
  });

  it.each(["", "njit.instructure.com", "http://njit.instructure.com"])("rejects the address %j", (url) => {
    expect(validateCanvasForm("1234~abcd", url).baseUrl).toMatch(/Canvas address/);
  });
});

describe("Canvas requests", () => {
  it("reads the connection state with the app token", async () => {
    await getCanvasStatus();
    expect(fetchMock).toHaveBeenCalledWith("/api/canvas/token", {
      method: "GET",
      headers: { Authorization: "Bearer app-token" },
      body: undefined,
    });
  });

  it("sends the trimmed Canvas token and address when connecting", async () => {
    await connectCanvas(" 1234~abcd \n", " https://njit.instructure.com ");
    expect(fetchMock).toHaveBeenCalledWith("/api/canvas/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer app-token" },
      body: JSON.stringify({ token: "1234~abcd", baseUrl: "https://njit.instructure.com" }),
    });
  });

  it("tests and disconnects with the right methods", async () => {
    await testCanvasConnection();
    await disconnectCanvas();
    await getImportedCourses();
    await syncNow();
    await getCalendarFeedStatus();
    await saveCalendarFeed(" https://canvas.example.edu/feed.ics ");
    await clearCalendarFeed();
    expect(fetchMock.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
      ["/api/canvas/token/test", "POST"],
      ["/api/canvas/token", "DELETE"],
      ["/api/canvas/courses", "GET"],
      ["/api/canvas/sync", "POST"],
      ["/api/canvas/calendar-feed", "GET"],
      ["/api/canvas/calendar-feed", "POST"],
      ["/api/canvas/calendar-feed", "DELETE"],
    ]);
    expect(fetchMock.mock.calls[5][1]).toMatchObject({
      body: JSON.stringify({ feedUrl: "https://canvas.example.edu/feed.ics" }),
    });
  });

  it("returns the API error for a bad token", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Canvas rejected this token" }, { status: 400 }));
    const result = await connectCanvas("bad", DEFAULT_CANVAS_URL);
    expect(result.ok).toBe(false);
    expect(!result.ok && canvasErrorMessage(result)).toBe("Canvas rejected this token");
  });
});

describe("canvasErrorMessage", () => {
  it("passes through Canvas errors", () => {
    expect(canvasErrorMessage({ ok: false, status: 502, error: "Could not reach Canvas" })).toBe(
      "Could not reach Canvas",
    );
  });

  it("explains an expired Priority session instead of saying Unauthorized", () => {
    expect(canvasErrorMessage({ ok: false, status: 401, error: "Unauthorized" })).toMatch(/session expired/);
  });
});

describe("sync requests", () => {
  it("reads the last synced time and runs a sync with the app token", async () => {
    await getLastSynced();
    await syncNow();
    expect(fetchMock.mock.calls.map(([path, init]) => [path, init.method, init.headers.Authorization])).toEqual([
      ["/api/canvas/sync", "GET", "Bearer app-token"],
      ["/api/canvas/sync", "POST", "Bearer app-token"],
    ]);
  });
});

describe("syncSummary", () => {
  const base = { lastSyncedAt: "2026-10-09T20:00:00.000Z", assignmentGroups: 3, grades: 1 };

  it("counts classes and assignments", () => {
    expect(syncSummary({ ...base, courses: 4, assignments: 28 })).toBe("Synced 4 classes and 28 assignments.");
  });

  it("uses singular words for one", () => {
    expect(syncSummary({ ...base, courses: 1, assignments: 1 })).toBe("Synced 1 class and 1 assignment.");
  });
});

describe("formatLastSynced", () => {
  const now = new Date("2026-10-09T20:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("says never when there is no time", () => {
    expect(formatLastSynced(null, now)).toBe("Never synced");
  });

  it("says just now inside the first minute", () => {
    expect(formatLastSynced(ago(20 * 1000), now)).toBe("Just now");
  });

  it("counts minutes, then hours", () => {
    expect(formatLastSynced(ago(60 * 1000), now)).toBe("1 minute ago");
    expect(formatLastSynced(ago(5 * 60 * 1000), now)).toBe("5 minutes ago");
    expect(formatLastSynced(ago(3 * 60 * 60 * 1000), now)).toBe("3 hours ago");
  });

  it("shows a date once it is a day old", () => {
    expect(formatLastSynced(ago(26 * 60 * 60 * 1000), now)).toMatch(/^Oct \d+, \d+:\d{2}/);
  });

  it("treats a bad timestamp as never synced", () => {
    expect(formatLastSynced("not a date", now)).toBe("Never synced");
  });
});
