import type { LetterBoundary } from "./letter-boundary";

// The student is at NJIT, so due dates and times read in campus time.
const TIME_ZONE = "America/New_York";
const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" });
const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric" });
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

// Whole New York calendar days from `from` to `to`, so "tomorrow" flips at midnight ET.
function nyDaysBetween(from: Date, to: Date): number {
  const dayNumber = (date: Date) => {
    const [year, month, day] = dayKeyFormatter.format(date).split("-").map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return dayNumber(to) - dayNumber(from);
}

// Short and relative where it helps scanning: "Due today, 11:59 PM", "Due tomorrow, 9:00 AM",
// "Due Fri, 11:59 PM" this week, then the date ("Due Fri, Nov 20") further out.
export function dueLabel(dueAt: string | null, overdue: boolean, now: Date = new Date()): string {
  const date = dueAt ? new Date(dueAt) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "No due date";
  }
  if (overdue) {
    return `Overdue, was due ${dateFormatter.format(date)}`;
  }
  const days = nyDaysBetween(now, date);
  const time = timeFormatter.format(date);
  if (days === 0) {
    return `Due today, ${time}`;
  }
  if (days === 1) {
    return `Due tomorrow, ${time}`;
  }
  if (days > 1 && days < 7) {
    return `Due ${weekdayFormatter.format(date)}, ${time}`;
  }
  return `Due ${dateFormatter.format(date)}`;
}

// The share badge: whole percents, and a real slice under 1% still shows as one.
export function shareLabel(share: number | null): string | null {
  if (share === null || !Number.isFinite(share) || share <= 0) {
    return null;
  }
  const whole = Math.round(share);
  return whole >= 1 ? `${whole}%` : "<1%";
}

// A short tag for the letter-cutoff flag; the reason line already says it in full.
export function boundaryTag(boundary: LetterBoundary | null): string | null {
  if (!boundary) {
    return null;
  }
  return boundary.direction === "at-risk" ? `${boundary.letter} at risk` : `${boundary.letter} within reach`;
}

// Puts an item back where it was, or at the end if the list has since shrunk below that spot.
export function insertAt<T>(items: readonly T[], item: T, index: number): T[] {
  const at = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, at), item, ...items.slice(at)];
}
