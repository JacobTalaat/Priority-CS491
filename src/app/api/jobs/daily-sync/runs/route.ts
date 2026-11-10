import { NextResponse } from "next/server";
import { checkCronSecret } from "@/lib/jobs/cron-secret";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const check = checkCronSecret(request);
  if (!check.ok) {
    return check.response;
  }
  try {
    const runs = await prisma.syncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 7,
    });
    return NextResponse.json({
      runs: runs.map((run) => ({
        runId: run.id,
        day: run.day,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        usersTotal: run.usersTotal,
        usersSucceeded: run.usersSucceeded,
        usersFailed: run.usersFailed,
        gradesPosted: run.gradesPosted,
      })),
    });
  } catch {
    // A failed read answers with JSON like the tick route, instead of an
    // empty 500 with an unhandled stack.
    return NextResponse.json({ error: "Could not load sync runs" }, { status: 500 });
  }
}
