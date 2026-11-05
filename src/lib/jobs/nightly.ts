import { messagesFor } from "@/lib/notification-messages";
import { nyDayOf } from "@/lib/ny-day";
import { prisma } from "@/lib/prisma";
import { loadOpenWork } from "@/lib/ranking-data";
import { sendToUser } from "@/lib/notify";

// A serverless tick runs under a hard per-request time limit, so it stops
// STARTING new users once this much of the tick is spent; every user it did
// start is awaited to completion. The next tick resumes with the rest.
export const NIGHTLY_TICK_BUDGET_MS = 40_000;

// A reminder whose time passed more than this long ago is too stale to send:
// the scheduler was down, and a "start tonight" nudge arriving at 23:30 is not
// useful. The day is still claimed so the user is not retried tonight.
export const LATE_SEND_LIMIT_MINUTES = 180;

const TIME_ZONE = "America/New_York";

// The default when stored nightlyReminderTime cannot be parsed, matching the
// column default in the schema.
const FALLBACK_REMINDER_MINUTES = 20 * 60;

// Wall-clock reading needs hour and minute only; en-GB with h23 keeps midnight
// at "00" instead of "24".
const NY_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type NightlyTickResult = {
  day: string;
  due: number;
  sent: number;
  nothingToSend: number;
  skippedLate: number;
  remaining: number;
};

// Minutes since midnight on the wall clock in America/New_York, DST-safe by
// construction: only the wall-clock HH:MM of "now" is ever read.
function nyMinutesOfDay(instant: Date): number {
  const parts = NY_CLOCK_FORMATTER.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((entry) => entry.type === type);
    return found ? found.value : "";
  };
  return Number(part("hour")) * 60 + Number(part("minute"));
}

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

export async function runNightlyTick(
  now: () => Date = () => new Date(),
): Promise<NightlyTickResult> {
  const tickStartedAt = now();
  const day = nyDayOf(tickStartedAt);

  const candidates = await prisma.user.findMany({
    where: {
      OR: [{ notifyTonight: true }, { notifyDueTomorrow: true }],
      pushSubscriptions: { some: {} },
      nightlyDeliveries: { none: { day } },
    },
    select: {
      id: true,
      notifyTonight: true,
      notifyDueTomorrow: true,
      nightlyReminderTime: true,
    },
    orderBy: { id: "asc" },
  });

  const owed = candidates.filter(
    (user) => reminderMinutesOf(user.nightlyReminderTime) <= nyMinutesOfDay(now()),
  );

  let sent = 0;
  let nothingToSend = 0;
  let skippedLate = 0;
  let processed = 0;
  for (const user of owed) {
    if (now().getTime() - tickStartedAt.getTime() >= NIGHTLY_TICK_BUDGET_MS) {
      break;
    }
    const tickInstant = now();
    const reminderMinutes = reminderMinutesOf(user.nightlyReminderTime);
    const lateBy = nyMinutesOfDay(tickInstant) - reminderMinutes;

    // Claim the delivery day first. The (user, day) key is unique, so when two
    // ticks overlap only one of them gets the student; the other moves on.
    let claimed = false;
    try {
      await prisma.nightlyDelivery.create({
        data: { userId: user.id, day, tonight: false, dueTomorrow: false },
      });
      claimed = true;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
    if (!claimed) {
      continue;
    }

    if (lateBy > LATE_SEND_LIMIT_MINUTES) {
      skippedLate += 1;
      processed += 1;
      continue;
    }

    try {
      const ranked = await loadOpenWork(user.id, tickInstant);
      const messages = messagesFor(
        {
          notifyTonight: user.notifyTonight,
          notifyGradePosted: false,
          notifyDueTomorrow: user.notifyDueTomorrow,
        },
        { ranked, now: tickInstant },
      );
      const tonight = messages.some((message) => message.kind === "tonight");
      const dueTomorrow = messages.some((message) => message.kind === "due-tomorrow");
      for (const message of messages) {
        await sendToUser(user.id, message);
      }
      await prisma.nightlyDelivery.update({
        where: { userId_day: { userId: user.id, day } },
        data: { tonight, dueTomorrow },
      });
      sent += messages.length;
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
    nothingToSend,
    skippedLate,
    remaining: owed.length - processed,
  };
}
