import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const preferenceSelect = {
  notifyTonight: true,
  notifyGradePosted: true,
  notifyDueTomorrow: true,
  nightlyReminderTime: true,
} as const;

// HH:MM in New York time, always zero-padded, so the nightly job ticket can
// compare the string directly against clock readings.
const NIGHTLY_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const INVALID_PREFERENCES =
  "Send notifyTonight, notifyGradePosted and notifyDueTomorrow as true or false, and nightlyReminderTime as HH:MM from 00:00 to 23:59.";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  const preferences = await prisma.user.findUnique({
    where: { id: user.id },
    select: preferenceSelect,
  });
  if (!preferences) {
    return unauthorized();
  }
  return NextResponse.json(preferences);
}

export async function PATCH(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  for (const key of Object.keys(body)) {
    if (!["notifyTonight", "notifyGradePosted", "notifyDueTomorrow", "nightlyReminderTime"].includes(key)) {
      return NextResponse.json({ error: INVALID_PREFERENCES }, { status: 400 });
    }
  }
  const entries = body as Record<string, unknown>;
  const data: { notifyTonight?: boolean; notifyGradePosted?: boolean; notifyDueTomorrow?: boolean; nightlyReminderTime?: string } = {};
  if ("notifyTonight" in entries) {
    if (typeof entries.notifyTonight !== "boolean") {
      return NextResponse.json({ error: INVALID_PREFERENCES }, { status: 400 });
    }
    data.notifyTonight = entries.notifyTonight;
  }
  if ("notifyGradePosted" in entries) {
    if (typeof entries.notifyGradePosted !== "boolean") {
      return NextResponse.json({ error: INVALID_PREFERENCES }, { status: 400 });
    }
    data.notifyGradePosted = entries.notifyGradePosted;
  }
  if ("notifyDueTomorrow" in entries) {
    if (typeof entries.notifyDueTomorrow !== "boolean") {
      return NextResponse.json({ error: INVALID_PREFERENCES }, { status: 400 });
    }
    data.notifyDueTomorrow = entries.notifyDueTomorrow;
  }
  if ("nightlyReminderTime" in entries) {
    if (typeof entries.nightlyReminderTime !== "string" || !NIGHTLY_TIME_PATTERN.test(entries.nightlyReminderTime)) {
      return NextResponse.json({ error: INVALID_PREFERENCES }, { status: 400 });
    }
    data.nightlyReminderTime = entries.nightlyReminderTime;
  }
  const preferences = await prisma.user.update({
    where: { id: user.id },
    data,
    select: preferenceSelect,
  });
  return NextResponse.json(preferences);
}
