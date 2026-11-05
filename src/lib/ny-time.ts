// Wall time is what students see: a reminder at "20:00" must fire at 20:00 on
// the New York wall clock, whatever UTC offset that wall moment sits in. These
// helpers are pure date math on top of Intl, with no dependency beyond it.

const NY_TZ = "America/New_York";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const NY_OFFSET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TZ,
  timeZoneName: "shortOffset",
});

// Minutes of wall time behind UTC at that instant: -240 in EDT, -300 in EST.
function nyOffsetMinutesAt(instant: number): number {
  const parts = NY_OFFSET_FORMATTER.formatToParts(new Date(instant));
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) {
    return 0;
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
}

// "YYYY-MM-DDTHH:MM" as the wall clock in New York reads that instant; the
// colon and hyphens make it directly comparable to the requested wall time.
const NY_WALL_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: NY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function nyWallKey(instant: number): string {
  const parts = NY_WALL_FORMATTER.formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((part) => part.type === type);
    return found ? found.value : "";
  };
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

// The instant whose New York wall clock reads this date and "HH:MM". Usually
// the wall time is just twice-converted UTC, corrected and re-checked once so
// a transition between the two passes settles. Two wall times have no unique
// answer and get a fixed pick:
//   - a time the spring-forward gap skipped (like 02:30 on a spring day) uses
//     the instant one wall-hour later (03:30, back in the real day);
//   - an ambiguous fall-back repeat (like 01:30) uses the earlier instant.
export function nyWallTimeToInstant(wallDay: string, wallTime: string): Date {
  const [year, month, date, hour, minute] = `${wallDay}T${wallTime}`
    .split(/[-T:]/)
    .map(Number);
  const requestedKey = `${wallDay}T${wallTime}`;
  // Guess by treating the wall time as if it were UTC, then correct with the
  // offset in effect at the guess, then re-check once.
  const asIfUtc = Date.UTC(year, month - 1, date, hour, minute);
  const first = asIfUtc - nyOffsetMinutesAt(asIfUtc) * MINUTE_MS;
  const second = asIfUtc - nyOffsetMinutesAt(first) * MINUTE_MS;
  if (first === second) {
    return new Date(first);
  }
  if (nyWallKey(first) === requestedKey) {
    return new Date(first);
  }
  if (nyWallKey(second) === requestedKey) {
    return new Date(second);
  }
  // Neither candidate reads the requested wall time: the wall hour was skipped,
  // so use the one on the later side of the gap, one wall-hour after the ask.
  return new Date(Math.max(first, second));
}

// The New York calendar day immediately before the given one, in YYYY-MM-DD.
export function previousNyDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const dayInstant = Date.UTC(year, month - 1, date);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(dayInstant - DAY_MS));
}

// Minutes since midnight back to "HH:MM", zero-padded the way reminders are stored.
export function nyTimeString(minutes: number): string {
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}
