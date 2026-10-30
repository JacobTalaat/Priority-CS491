import type { LetterBoundary } from "./letter-boundary";

// The student is at NJIT, so due dates and times read in campus time.
const dueFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function dueLabel(dueAt: string | null, overdue: boolean): string {
  const date = dueAt ? new Date(dueAt) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return "No due date";
  }
  const when = dueFormatter.format(date);
  return overdue ? `Overdue, was due ${when}` : `Due ${when}`;
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
