import { messagesFor } from "@/lib/notification-messages";
import { nyDayOf } from "@/lib/ny-day";
import {
  nyTimeString,
  nyWallTimeToInstant,
  previousNyDay,
} from "@/lib/ny-time";
import { sendToUser } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import type { RankedItem } from "@/lib/ranking";
import { loadOpenWork } from "@/lib/ranking-data";

// A serverless tick runs under a hard per-request time limit, so it stops
// STARTING new users once this much of the tick is spent; every user it did
// start is awaited to completion. A started user costs at most 10 s of load
// (the race below times out) plus 10 s of sends in parallel, so the worst
// tick is 30 s of starts + 10 s + 10 s, inside the route's 60 s window.
export const NIGHTLY_TICK_BUDGET_MS = 30_000;

// A load that hangs is raced against this timer: budget checks only guard
// STARTING a user, so an unbounded load could run the request past its limit
// and lose the claimed reminder. On timeout the claim stays and the tick
// moves on, exactly like any other per-user failure.
export const NIGHTLY_USER_LOAD_TIMEOUT_MS = 10_000;

// A scheduled reminder whose occurrence passed more than this long ago is too
// stale to send: the scheduler was down, and a "start tonight" nudge arriving
// at 23:30 is not useful. The day is still claimed so the user is not retried
// that night.
export const LATE_SEND_LIMIT_MINUTES = 180;

// A LastEventId-free web push lives for this long. Twelve hours would let a
// "Tonight" push arrive the next morning, when the advice is stale.
export const NIGHTLY_PUSH_TTL_SECONDS = 2 * 60 * 60;

// The default when stored nightlyReminderTime cannot be parsed, matching the
// column default in the schema.
const FALLBACK_REMINDER_MINUTES = 20 * 60;

export type NightlyTickResult = {
  day: string;
  due: number;
  sent: number;
  failed: number;
  nothingToSend: number;
  skippedLate: number;
  remaining: number;
};

// "HH:MM" to minutes since midnight; anything unparseable falls back to 20:00.
function reminderMinutesOf(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    return FALLBACK_REMINDER_MINUTES;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function loadRankedWithTimeout(userId: string, occurrenceInstant: Date): Promise<RankedItem[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("nightly: load timed out")),
      NIGHTLY_USER_LOAD_TIMEOUT_MS,
    );
    loadOpenWork(userId, occurrenceInstant).then(
      (ranked) => {
        clearTimeout(timer);
        resolve(ranked);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function runNightlyTick(
  now: () => Date = () => new Date(),
): Promise<NightlyTickResult> {
  const tickStartedAt = now();
  const day = nyDayOf(tickStartedAt);
  const previousDay = previousNyDay(day);

  const candidates = await prisma.user.findMany({
    where: {
      OR: [{ notifyTonight: true }, { notifyDueTomorrow: true }],
      pushSubscriptions: { some: {} },
    },
    select: {
      id: true,
      notifyTonight: true,
      notifyDueTomorrow: true,
      nightlyReminderTime: true,
    },
    orderBy: { id: "asc" },
  });

  // One row claims the whole night's bundle, so a row for the occurrence day
  // means the reminder was handled. Without that row in hand the candidate
  // goes back through the claim below, whose unique key settles overlaps too.
  const decided = await prisma.nightlyDelivery.findMany({
    where: { day: { in: [day, previousDay] } },
    select: { userId: true, day: true },
  });
  const decidedDays = new Set(decided.map((row) => `${row.userId}\n${row.day}`));

  const owed: Array<{
    user: (typeof candidates)[number];
    occurrenceDay: string;
    occurrenceInstant: Date;
  }> = [];
  for (const user of candidates) {
    const tickInstant = now();
    const reminderMinutes = reminderMinutesOf(user.nightlyReminderTime);
    const reminderTime = nyTimeString(reminderMinutes);
    // The reminder the student is owed is the most recent scheduled occurrence
    // at or before now: tonight's time if it already struck, otherwise just
    // before midnight struck their time from yesterday — the 00:05 tick must
    // still deliver a 23:45 reminder, keyed to the previous New York day.
    const tonightAtReminder = nyWallTimeToInstant(day, reminderTime);
    const occurrence =
      tonightAtReminder.getTime() <= tickInstant.getTime()
        ? { day, instant: tonightAtReminder }
        : {
            day: previousDay,
            instant: nyWallTimeToInstant(previousDay, reminderTime),
          };
    if (decidedDays.has(`${user.id}\n${occurrence.day}`)) {
      continue;
    }
    owed.push({
      user,
      occurrenceDay: occurrence.day,
      occurrenceInstant: occurrence.instant,
    });
  }

  let sent = 0;
  let failed = 0;
  let nothingToSend = 0;
  let skippedLate = 0;
  let processed = 0;
  for (const { user, occurrenceDay, occurrenceInstant } of owed) {
    if (now().getTime() - tickStartedAt.getTime() >= NIGHTLY_TICK_BUDGET_MS) {
      break;
    }
    // Claim the occurrence first. The (user, day) key is unique, so when two
    // ticks overlap only one of them gets the student; the other moves on.
    let claimed = false;
    try {
      await prisma.nightlyDelivery.create({
        data: { userId: user.id, day: occurrenceDay, tonight: false, dueTomorrow: false },
      });
      claimed = true;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
    if (!claimed) {
      // Another tick took this user; their night is being handled, so they
      // never sit in `remaining`.
      processed += 1;
      continue;
    }

    if (
      now().getTime() - occurrenceInstant.getTime() >
      LATE_SEND_LIMIT_MINUTES * 60_000
    ) {
      skippedLate += 1;
      processed += 1;
      continue;
    }

    try {
      // "Due tomorrow" is read as of the evening the student asked about, not
      // the 00:05 instant's date.
      const ranked = await loadRankedWithTimeout(user.id, occurrenceInstant);
      const messages = messagesFor(
        {
          notifyTonight: user.notifyTonight,
          notifyGradePosted: false,
          notifyDueTomorrow: user.notifyDueTomorrow,
        },
        { ranked, now: occurrenceInstant },
      );
      // All messages go out in one parallel round, so the user is bounded by
      // one web-push timeout rather than one per message.
      const counts = await Promise.all(
        messages.map((message) => sendToUser(user.id, message, { ttlSeconds: NIGHTLY_PUSH_TTL_SECONDS })),
      );
      let tonight = false;
      let dueTomorrow = false;
      messages.forEach((message, index) => {
        // A message with no delivered push reads as no delivery: without this
        // a send-failure could burn the claim while nothing ever arrived.
        if (counts[index].sent > 0) {
          sent += 1;
          if (message.kind === "tonight") {
            tonight = true;
          } else if (message.kind === "due-tomorrow") {
            dueTomorrow = true;
          }
        } else {
          failed += 1;
        }
      });
      await prisma.nightlyDelivery.update({
        where: { userId_day: { userId: user.id, day: occurrenceDay } },
        data: { tonight, dueTomorrow },
      });
      if (messages.length === 0) {
        nothingToSend += 1;
      }
    } catch {
      // Fixed fields only: no id, no email, no endpoint, no raw error text.
      console.error("nightly: send failed for one user");
    }
    processed += 1;
  }

  return {
    day,
    due: owed.length,
    sent,
    failed,
    nothingToSend,
    skippedLate,
    remaining: owed.length - processed,
  };
}
