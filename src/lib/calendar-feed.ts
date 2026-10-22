import ICAL from "ical.js";
import { assertPublicHost, isInternalHostname } from "@/lib/public-host";

const MAX_FEED_BYTES = 2 * 1024 * 1024;

export class CalendarFeedError extends Error {
  constructor(message = "Could not read the Canvas calendar feed. Check that the link is current and publicly accessible.") {
    super(message);
    this.name = "CalendarFeedError";
  }
}

export function normalizeCalendarFeedUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Enter your Canvas calendar feed link.");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid Canvas calendar feed link.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    // .local is mDNS: not global, so a public "resolution" would be a lie
    url.hostname.toLowerCase().endsWith(".local") ||
    isInternalHostname(url.hostname)
  ) {
    throw new Error("Use a public HTTPS Canvas calendar feed link.");
  }
  return url.toString();
}

export type CalendarAssignmentEvent = {
  courseCanvasId: string;
  assignmentCanvasId: string;
  title: string;
  dueAt: Date;
  htmlUrl: string;
};

function getCanvasAssignmentReference(urlValue: string | null): {
  courseCanvasId: string;
  assignmentCanvasId: string;
} | null {
  if (!urlValue) {
    return null;
  }
  try {
    const path = new URL(urlValue).pathname;
    const match = path.match(/\/courses\/([^/]+)\/assignments\/([^/]+)(?:\/|$)/);
    return match ? { courseCanvasId: match[1], assignmentCanvasId: match[2] } : null;
  } catch {
    return null;
  }
}

export function parseCalendarFeed(source: string): CalendarAssignmentEvent[] {
  if (Buffer.byteLength(source, "utf8") > MAX_FEED_BYTES) {
    throw new CalendarFeedError();
  }
  try {
    const calendar = new ICAL.Component(ICAL.parse(source));
    if (calendar.name !== "vcalendar") {
      throw new CalendarFeedError();
    }
    const events: CalendarAssignmentEvent[] = [];
    for (const component of calendar.getAllSubcomponents("vevent")) {
      const event = new ICAL.Event(component);
      const rawUrl = component.getFirstPropertyValue("url");
      if (typeof rawUrl !== "string") {
        continue;
      }
      const reference = getCanvasAssignmentReference(rawUrl);
      const dueAt = event.startDate?.toJSDate();
      if (
        !reference ||
        !event.uid ||
        !event.summary?.trim() ||
        !(dueAt instanceof Date) ||
        Number.isNaN(dueAt.getTime())
      ) {
        continue;
      }
      events.push({
        ...reference,
        title: event.summary.trim(),
        dueAt,
        htmlUrl: rawUrl,
      });
    }
    return events;
  } catch (error) {
    if (error instanceof CalendarFeedError) {
      throw error;
    }
    throw new CalendarFeedError();
  }
}

export async function fetchCalendarFeed(feedUrl: string): Promise<CalendarAssignmentEvent[]> {
  let url: string;
  try {
    url = normalizeCalendarFeedUrl(feedUrl);
  } catch {
    throw new CalendarFeedError();
  }
  // assertPublicHost resolves the hostname and refuses private answers, so a
  // public-looking feed host cannot quietly point at an internal address. Like
  // canvasFetch this is lookup-then-fetch: DNS rebinding between our lookup and
  // fetch's own lookup remains possible until the resolved IP is pinned into
  // the connection. Redirects are refused here too (redirect: "error").
  try {
    await assertPublicHost(new URL(url).hostname);
  } catch {
    throw new CalendarFeedError();
  }
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "text/calendar" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CalendarFeedError();
  }
  if (!response.ok) {
    throw new CalendarFeedError();
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FEED_BYTES) {
    throw new CalendarFeedError();
  }
  let source: string;
  try {
    source = await response.text();
  } catch {
    throw new CalendarFeedError();
  }
  if (Buffer.byteLength(source, "utf8") > MAX_FEED_BYTES) {
    throw new CalendarFeedError();
  }
  return parseCalendarFeed(source);
}
