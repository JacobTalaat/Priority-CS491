import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CANVAS_URL,
  canvasErrorMessage,
  clearCalendarFeed,
  connectCanvas,
  disconnectCanvas,
  getCalendarFeedStatus,
  getImportedCourses,
  getCanvasStatus,
  syncCanvas,
  saveCalendarFeed,
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
    await syncCanvas();
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
