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
// and lose the claimed reminder. On timeout the attempt had delivered nothing,
// so the claim is released and a later tick that night retries.
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

// The owed order is not the priority order: a student whose night keeps
// failing (for example the work list load times out) is released back into the
// next tick's owed list, and in plain user-id order that stuck student sits
// ahead of everyone later in the alphabet on every tick, eating the whole tick
// budget until they age past the late limit. There is no schema row to
// remember who failed, so each tick shuffles the owed order once instead: the
// budget is then shared fairly, and nothing else changes, because the claim's
// unique key already settles any overlap between ticks.
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
  return items;
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

  // A row for the occurrence day means the night was handled or an attempt is
  // in progress: a row stays put once something was delivered or the late
  // window closed, and an attempt that delivered nothing deletes its row, so a
  // later tick that night sees no row here and re-claims. Without a row in
  // hand the candidate goes back through the claim below, whose unique key
  // settles overlaps too.
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
  shuffle(owed);

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

    // Whether anything was delivered is tracked outside the try, so a failure
    // after a delivery can never talk the tick into releasing the claim.
    let deliveredAny = false;
    // The release is a guarded delete wrapped in its own try/catch: on failure
    // the worst case is the old behaviour — the night stays claimed — so the
    // tick keeps going and never retries the release through the catch below.
    const releaseClaim = async () => {
      try {
        await prisma.nightlyDelivery.deleteMany({
          where: { userId: user.id, day: occurrenceDay, tonight: false, dueTomorrow: false },
        });
      } catch {
        console.error("nightly: could not release claim for one user");
      }
    };
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
      if (messages.length === 0) {
        // Nothing to name tonight is still a handled night: the claim stays so
        // a later tick does not rescan and send an empty reminder again.
        await prisma.nightlyDelivery.update({
          where: { userId_day: { userId: user.id, day: occurrenceDay } },
          data: { tonight: false, dueTomorrow: false },
        });
        nothingToSend += 1;
      } else {
        // All messages go out in one parallel round, so the user is bounded by
        // one web-push timeout rather than one per message. Each send is
        // judged on its own result so one rejected send cannot hide a sibling
        // that WAS delivered: with Promise.all a single rejection would fall
        // into the catch, release the claim, and the retry would send the
        // delivered message a second time.
        const results = await Promise.allSettled(
          messages.map((message) => sendToUser(user.id, message, { ttlSeconds: NIGHTLY_PUSH_TTL_SECONDS })),
        );
        let tonight = false;
        let dueTomorrow = false;
        results.forEach((result, index) => {
          const counts = result.status === "fulfilled" ? result.value : null;
          if (counts && counts.sent > 0) {
            sent += 1;
            deliveredAny = true;
            if (messages[index].kind === "tonight") {
              tonight = true;
            } else if (messages[index].kind === "due-tomorrow") {
              dueTomorrow = true;
            }
          } else {
            failed += 1;
          }
        });
        if (deliveredAny) {
          // At least one push arrived, so the night is handled: keep the claim
          // with the delivered flags. Retrying would re-send the whole bundle
          // and could duplicate the delivered push, and a delivered reminder
          // is never sent twice.
          await prisma.nightlyDelivery.update({
            where: { userId_day: { userId: user.id, day: occurrenceDay } },
            data: { tonight, dueTomorrow },
          });
        } else {
          // Nothing arrived, so the night was not handled: give the claim back
          // so a later tick that night retries. The delete is guarded by the
          // flags it must not have, so it can never remove a row that records
          // a delivery.
          await releaseClaim();
        }
      }
    } catch {
      // Fixed fields only: no id, no email, no endpoint, no raw error text.
      console.error("nightly: send failed for one user");
      if (!deliveredAny) {
        failed += 1;
        await releaseClaim();
      }
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
