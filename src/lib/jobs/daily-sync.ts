import { CalendarFeedError } from "@/lib/calendar-feed";
import { CanvasError } from "@/lib/canvas";
import { acquireSyncLock, releaseSyncLock, syncUser } from "@/lib/import/sync";
import { prisma } from "@/lib/prisma";

// A serverless tick runs under a hard per-request time limit, so it stops
// STARTING new users once this much of the tick is spent; every user it did
// start is awaited to completion. The next tick resumes with the rest.
export const TICK_BUDGET_MS = 40_000;

// An attempt left unfinished for longer than this is one whose process was
// killed; the next tick reaps it as a timeout instead of retrying the user.
const STALE_ATTEMPT_MS = 5 * 60_000;

const TIME_ZONE = "America/New_York";

type FailureKind = "unauthorized" | "network" | "http" | "timeout" | "other";

// The stored message is fixed per kind: it must never carry the raw error
// text, which can contain feed URLs or tokens. Kinds still tell a reader what
// went wrong at a glance.
const FAILURE_MESSAGES: Record<FailureKind, string> = {
  unauthorized: "Stored Canvas credentials were rejected by Canvas.",
  network: "Canvas could not be reached.",
  http: "Canvas returned an error response.",
  timeout: "The sync for this user exceeded its time budget.",
  other: "The sync failed for an unexpected reason.",
};

export type TickResult = {
  day: string;
  attemptedThisTick: number;
  remaining: number;
  usersSucceeded: number;
  usersFailed: number;
  gradesPosted: number;
  finished: boolean;
};

export function dayInNewYork(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function classifyFailure(error: unknown): FailureKind {
  if (error instanceof CanvasError) {
    if (error.kind === "unauthorized") {
      return "unauthorized";
    }
    if (error.kind === "network") {
      return "network";
    }
    return "http";
  }
  if (error instanceof CalendarFeedError) {
    return "other";
  }
  return "other";
}

const CONNECTED_USERS_WHERE = {
  OR: [
    {
      canvasTokenCipher: { not: null },
      canvasTokenIv: { not: null },
      canvasTokenTag: { not: null },
      canvasBaseUrl: { not: null },
    },
    {
      canvasCalendarFeedCipher: { not: null },
      canvasCalendarFeedIv: { not: null },
      canvasCalendarFeedTag: { not: null },
    },
  ],
};

export async function runDailyTick(now: () => Date = () => new Date()): Promise<TickResult> {
  const tickStartedAt = now();
  const day = dayInNewYork(tickStartedAt);
  const run = await prisma.syncRun.upsert({
    where: { day },
    create: { day, usersTotal: 0, usersSucceeded: 0, usersFailed: 0, gradesPosted: 0 },
    update: {},
  });

  // Reap attempts whose process died mid-sync so their user is measured once
  // per day and never run again today.
  const staleCutoff = new Date(tickStartedAt.getTime() - STALE_ATTEMPT_MS);
  const stale = await prisma.syncAttempt.findMany({
    where: { runId: run.id, finishedAt: null, startedAt: { lte: staleCutoff } },
    select: { id: true, userId: true },
  });
  for (const attempt of stale) {
    await prisma.syncAttempt.update({
      where: { id: attempt.id },
      data: { finishedAt: tickStartedAt, outcome: "timeout" },
    });
    await prisma.syncFailure.create({
      data: { runId: run.id, userId: attempt.userId, kind: "timeout", message: FAILURE_MESSAGES.timeout },
    });
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { usersFailed: { increment: 1 } },
    });
    // Fixed fields only: no email, no URL, no token, no raw error text.
    console.error(`daily-sync: runId=${run.id} kind=timeout reaped a stale attempt for one user`);
  }

  const connected = await prisma.user.findMany({
    where: CONNECTED_USERS_WHERE,
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const attempted = await prisma.syncAttempt.findMany({
    where: { runId: run.id },
    select: { userId: true },
  });
  const attemptedToday = new Set(attempted.map((row) => row.userId));
  const owed = connected.map((user) => user.id).filter((id) => !attemptedToday.has(id));

  let attemptedThisTick = 0;
  for (const userId of owed) {
    if (now().getTime() - tickStartedAt.getTime() >= TICK_BUDGET_MS) {
      break;
    }
    // Claim today's attempt first. The (run, user) key is unique, so when two ticks
    // overlap only one of them gets the student; the other moves on.
    let attempt: { id: string };
    try {
      attempt = await prisma.syncAttempt.create({ data: { runId: run.id, userId } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        continue;
      }
      throw error;
    }
    attemptedThisTick += 1;
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { usersTotal: { increment: 1 } },
    });
    if (!(await acquireSyncLock(userId))) {
      // the student is mid "Sync now": leave them one attempt for today
      await prisma.syncAttempt.update({
        where: { id: attempt.id },
        data: { finishedAt: now(), outcome: "skipped-locked" },
      });
      continue;
    }
    try {
      const result = await syncUser(userId);
      await prisma.syncAttempt.update({
        where: { id: attempt.id },
        data: { finishedAt: now(), outcome: "succeeded" },
      });
      await prisma.syncRun.update({
        where: { id: run.id },
        data: { usersSucceeded: { increment: 1 }, gradesPosted: { increment: result.gradesPosted } },
      });
    } catch (error) {
      const kind = classifyFailure(error);
      await prisma.syncAttempt.update({
        where: { id: attempt.id },
        data: { finishedAt: now(), outcome: kind },
      });
      await prisma.syncFailure.create({
        data: { runId: run.id, userId, kind, message: FAILURE_MESSAGES[kind] },
      });
      await prisma.syncRun.update({
        where: { id: run.id },
        data: { usersFailed: { increment: 1 } },
      });
      // Fixed fields only: no email, no URL, no token, no raw error text.
      console.error(`daily-sync: runId=${run.id} kind=${kind} sync failed for one user`);
    } finally {
      await releaseSyncLock(userId);
    }
  }

  const remaining = owed.length - attemptedThisTick;
  const finished = remaining === 0;
  const counters = finished
    ? await prisma.syncRun.update({
        where: { id: run.id },
        data: { finishedAt: now() },
      })
    : await prisma.syncRun.findUniqueOrThrow({
        where: { id: run.id },
        select: { usersSucceeded: true, usersFailed: true, gradesPosted: true },
      });
  return {
    day,
    attemptedThisTick,
    remaining,
    usersSucceeded: counters.usersSucceeded,
    usersFailed: counters.usersFailed,
    gradesPosted: counters.gradesPosted,
    finished,
  };
}
