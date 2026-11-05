import { type RankedItem } from "./ranking";

// The grade letter a borderline item can push across, and whether that would
// hurt or help; a later ticket attaches one of these to each ranked item.
export type ReasonBoundary = {
  letter: string;
  direction: "at-risk" | "within-reach";
};

const DAY_MS = 24 * 60 * 60 * 1000;

// en-CA formats Gregorian dates as YYYY-MM-DD.
const NY_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Fixed list instead of Intl so the reason text cannot drift with locale data.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Letters spoken as if they start with a vowel sound: "an A", "an F", "an M";
// U is the exception that starts with a consonant sound ("you"): "a U".
const AN_LETTERS = new Set(["A", "E", "F", "H", "I", "L", "M", "N", "O", "R", "S", "X"]);

function nyDayOf(date: Date): string {
  // formatToParts instead of trusting the formatted string's shape, so the
  // day key survives a locale data change reordering the pieces.
  const parts = NY_DAY_FORMATTER.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((entry) => entry.type === type);
    return found ? found.value : "";
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / DAY_MS;
}

// When: overdue first, then New York calendar days ahead of today. An item
// with a due day but no overdue flag is never behind today, so a negative
// diff can only come from callers bypassing rankOpenWork.
function whenPart(item: RankedItem, now: Date): string {
  if (item.dueDay === null) {
    return "No due date";
  }
  const daysAhead = dayNumber(item.dueDay) - dayNumber(nyDayOf(now));
  if (item.overdue) {
    // Overdue work ranks within today, so the reason has to say how late it is:
    // half an hour late and a week late are different situations.
    if (daysAhead >= 0) {
      return "Overdue since earlier today";
    }
    if (daysAhead === -1) {
      return "Overdue since yesterday";
    }
    const [lateYear, lateMonth, lateDay] = item.dueDay.split("-").map(Number);
    return `Overdue since ${WEEKDAYS[new Date(Date.UTC(lateYear, lateMonth - 1, lateDay)).getUTCDay()]}`;
  }
  if (daysAhead <= 0) {
    return "Due today";
  }
  if (daysAhead === 1) {
    return "Due tomorrow";
  }
  const [year, month, day] = item.dueDay.split("-").map(Number);
  if (daysAhead <= 6) {
    // Plain UTC math on the calendar date, not an instant: the weekday of the
    // due day itself, wherever the item's clock time falls.
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    return `Due ${weekday}`;
  }
  return `Due ${MONTHS[month - 1]} ${day}`;
}

function weightPart(item: RankedItem): string | null {
  if (item.share === null || !Number.isFinite(item.share)) {
    return null;
  }
  const whole = Math.round(item.share);
  if (whole >= 1) {
    return `${whole} percent of your grade`;
  }
  // A real slice that rounds away to zero still matters more than no share.
  if (item.share > 0) {
    return "under 1 percent of your grade";
  }
  return null;
}

function hoursPart(item: RankedItem): string | null {
  if (typeof item.hours !== "number" || !Number.isFinite(item.hours) || item.hours <= 0) {
    return null;
  }
  if (item.hours < 1) {
    const minutes = Math.round((item.hours * 60) / 5) * 5;
    // A real estimate never reads as zero work.
    if (minutes < 5) {
      return "under 5 minutes";
    }
    // A hair under an hour rounds up to a whole hour, not "60 minutes".
    if (minutes >= 60) {
      return "about 1 hour";
    }
    return `about ${minutes} minutes`;
  }
  // Half-hour steps, so two estimates the ranking treats differently (1 hour and
  // 1.5 hours) do not read the same next to each other.
  const hours = Math.round(item.hours * 2) / 2;
  return hours === 1 ? "about 1 hour" : `about ${hours} hours`;
}

function articleFor(letter: string): string {
  // Grade letters may carry modifiers ("A-", "B+"); only the letter itself
  // decides the sound.
  return AN_LETTERS.has(letter[0].toUpperCase()) ? "an" : "a";
}

function boundaryPart(boundary: ReasonBoundary): string {
  if (boundary.direction === "at-risk") {
    return `could drop you below ${articleFor(boundary.letter)} ${boundary.letter}`;
  }
  return `could lift you to ${articleFor(boundary.letter)} ${boundary.letter}`;
}

export function reasonFor(
  item: RankedItem,
  now: Date,
  boundary?: ReasonBoundary | null,
): string {
  return [whenPart(item, now), weightPart(item), hoursPart(item), boundary ? boundaryPart(boundary) : null]
    .filter((part): part is string => part !== null)
    .join(", ");
}

export function withReasons<
  // The boundary is optional in the constraint so plain RankedItems are
  // accepted today and items carrying the field are accepted once the
  // ranking ticket adds it.
  T extends RankedItem & { boundary?: ReasonBoundary | null },
>(
  items: readonly T[],
  now: Date,
  boundaries?: ReadonlyMap<string, ReasonBoundary>,
): Array<T & { reason: string }> {
  return items.map((item) => {
    // A boundary attached to the item wins over the assignmentId map.
    const boundary = item.boundary ?? boundaries?.get(item.assignmentId) ?? null;
    return { ...item, reason: reasonFor(item, now, boundary) };
  });
}
