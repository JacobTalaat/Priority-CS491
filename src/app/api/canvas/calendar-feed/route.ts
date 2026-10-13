import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import {
  clearCalendarFeed,
  getCalendarFeedStatus,
  saveCalendarFeed,
} from "@/lib/calendar-feed-credentials";
import { CalendarFeedError, fetchCalendarFeed, normalizeCalendarFeedUrl } from "@/lib/calendar-feed";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  return NextResponse.json(await getCalendarFeedStatus(user.id));
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("feedUrl" in body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  let feedUrl: string;
  try {
    feedUrl = normalizeCalendarFeedUrl(body.feedUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enter a valid Canvas calendar feed link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  try {
    await fetchCalendarFeed(feedUrl);
  } catch (error) {
    if (error instanceof CalendarFeedError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
  await saveCalendarFeed(user.id, feedUrl);
  return NextResponse.json({ configured: true });
}

export async function DELETE(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  await clearCalendarFeed(user.id);
  return NextResponse.json({ configured: false });
}
