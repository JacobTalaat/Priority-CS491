import { NextResponse } from "next/server";
import { runNightlyTick } from "@/lib/jobs/nightly";
import { checkCronSecret } from "@/lib/jobs/cron-secret";

export const dynamic = "force-dynamic";
// A tick must not be reaped by the host mid-run; the 40 s job budget and the
// awaited last user fit inside this window.
export const maxDuration = 60;

// Vercel Cron sends GET with `Authorization: Bearer <CRON_SECRET>`; POST is
// the same tick for curl-style schedulers.
async function tick(request: Request): Promise<NextResponse> {
  const check = checkCronSecret(request);
  if (!check.ok) {
    return check.response;
  }
  try {
    const result = await runNightlyTick();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Nightly reminders failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return tick(request);
}

export async function GET(request: Request) {
  return tick(request);
}
