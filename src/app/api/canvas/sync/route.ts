import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { CanvasError } from "@/lib/canvas";
import { CalendarFeedError } from "@/lib/calendar-feed";
import { deliverGradePostedNotifications } from "@/lib/grade-posted-notify";
import { acquireSyncLock, releaseSyncLock, syncUser } from "@/lib/import/sync";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  const acquired = await acquireSyncLock(user.id);
  if (!acquired) {
    return NextResponse.json(
      { error: "A sync is already running for your account. Try again in a minute." },
      { status: 409 }
    );
  }
  let syncResult: Awaited<ReturnType<typeof syncUser>> | null = null;
  let syncError: unknown = null;
  try {
    syncResult = await syncUser(user.id);
  } catch (error) {
    syncError = error;
  } finally {
    await releaseSyncLock(user.id);
  }
  if (syncResult !== null) {
    // Pushes go out once the sync lock is free and must never fail the response.
    try {
      await deliverGradePostedNotifications(user.id);
    } catch {
      console.error("grade-posted: delivery failed for one user");
    }
    return NextResponse.json(syncResult);
  }
  const error = syncError;
  if (error instanceof Error && error.message === "Canvas not connected") {
    return NextResponse.json({ error: "Canvas not connected" }, { status: 409 });
  }
  if (error instanceof CalendarFeedError) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  if (error instanceof CanvasError && error.kind === "unauthorized") {
    return NextResponse.json({ error: "Canvas rejected this token" }, { status: 400 });
  }
  if (error instanceof CanvasError && error.kind === "network") {
    return NextResponse.json({ error: "Could not reach Canvas" }, { status: 502 });
  }
  if (error instanceof CanvasError) {
    return NextResponse.json({ error: "Canvas request failed" }, { status: 502 });
  }
  return NextResponse.json({ error: "Sync failed" }, { status: 500 });
}

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { lastSyncedAt: true },
  });
  return NextResponse.json({ lastSyncedAt: dbUser?.lastSyncedAt ?? null });
}
