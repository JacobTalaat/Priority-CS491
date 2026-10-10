import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCalendarFeed, normalizeCalendarFeedUrl, parseCalendarFeed } from "./calendar-feed";

const ICALENDAR = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:assignment_987@example.instructure.com
DTSTART;TZID=America/New_York:20261014T153000
DTEND;TZID=America/New_York:20261014T163000
SUMMARY:Read chapter 4\\, then submit
URL:https://canvas.example.edu/courses/123/assignments/987
END:VEVENT
END:VCALENDAR`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseCalendarFeed", () => {
  it("parses course assignment events and their zoned due dates", () => {
    expect(parseCalendarFeed(ICALENDAR)).toEqual([
      {
        courseCanvasId: "123",
        assignmentCanvasId: "987",
        title: "Read chapter 4, then submit",
        dueAt: new Date("2026-10-14T19:30:00.000Z"),
        htmlUrl: "https://canvas.example.edu/courses/123/assignments/987",
      },
    ]);
  });

  it("ignores calendar events that are not linked to a Canvas course assignment", () => {
    const feed = ICALENDAR.replace(
      "URL:https://canvas.example.edu/courses/123/assignments/987",
      "URL:https://canvas.example.edu/calendar",
    );
    expect(parseCalendarFeed(feed)).toEqual([]);
  });

  it("rejects malformed iCalendar documents with a clear error", () => {
    expect(() => parseCalendarFeed("not a calendar")).toThrow(
      "Could not read the Canvas calendar feed",
    );
  });
});

describe("normalizeCalendarFeedUrl", () => {
  it("normalizes a public HTTPS feed link", () => {
    expect(normalizeCalendarFeedUrl(" https://canvas.example.edu/feeds/calendar.ics ")).toBe(
      "https://canvas.example.edu/feeds/calendar.ics",
    );
  });

  it.each(["", "http://canvas.example.edu/feed", "https://localhost/feed", "https://192.168.1.2/feed"])(
    "rejects an unsafe feed link %j",
    (url) => {
      expect(() => normalizeCalendarFeedUrl(url)).toThrow();
    },
  );
});

describe("fetchCalendarFeed", () => {
  it("returns a clear error for an unavailable feed URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
    await expect(fetchCalendarFeed("https://canvas.example.edu/feed.ics")).rejects.toThrow(
      "Could not read the Canvas calendar feed",
    );
  });

  it("rejects redirects rather than following an untrusted feed URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("redirect blocked")));
    await expect(fetchCalendarFeed("https://canvas.example.edu/feed.ics")).rejects.toThrow(
      "Could not read the Canvas calendar feed",
    );
  });
});
