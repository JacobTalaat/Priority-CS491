export type OpenWorkItem = {
  assignmentId: string;
  courseId: string;
  courseName: string;
  title: string;
  dueAt: Date | null;
  share: number | null;
  // Hours are not stored yet: PR-124 makes a plan's total the hours, and the
  // score already divides by them.
  hours: number | null;
  graded: boolean;
};

export type RankedItem = OpenWorkItem & {
  // YYYY-MM-DD in America/New_York, null when the item has no due date.
  dueDay: string | null;
  overdue: boolean;
  score: number | null;
};

// Overdue ungraded work stays on the list for seven New York calendar days so
// the top of the list stays short enough to act on; older missing work is
// noise. Calendar days, not 7*24 hours, so DST does not shift the cut.
const OVERDUE_KEEP_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HOURS = 1;

// en-CA formats Gregorian dates as YYYY-MM-DD.
const NY_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dueDayOf(date: Date): string {
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

function usableHours(hours: number | null): number {
  return typeof hours === "number" && Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_HOURS;
}

function scoreOf(item: OpenWorkItem): number | null {
  if (item.share === null || !Number.isFinite(item.share)) {
    return null;
  }
  return item.share / usableHours(item.hours);
}

// A null score means the item's cost is unknowable, so it ranks after every
// item whose score is known. Scored items: higher first.
function compareScores(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function compareTies(a: RankedItem, b: RankedItem): number {
  if (a.title !== b.title) {
    return a.title < b.title ? -1 : 1;
  }
  if (a.assignmentId !== b.assignmentId) {
    return a.assignmentId < b.assignmentId ? -1 : 1;
  }
  return 0;
}

function compareByDueAt(a: RankedItem, b: RankedItem): number {
  const aDue = a.dueAt?.getTime() ?? 0;
  const bDue = b.dueAt?.getTime() ?? 0;
  if (aDue !== bDue) {
    return aDue - bDue;
  }
  return compareTies(a, b);
}

export function rankOpenWork(items: readonly OpenWorkItem[], now: Date): RankedItem[] {
  // "Due sooner" means the sooner calendar day in New York, not the sooner
  // timestamp: within one evening the bigger item should win, not whichever is
  // due a minute earlier. Overdue work keeps its real dueAt and dueDay in the
  // output but races in today's bucket, so share decides against tonight's
  // items instead of beating them on age alone.
  const nowMs = now.getTime();
  const todayDay = dueDayOf(now);
  const todayDayNumber = dayNumber(todayDay);

  const ranked: RankedItem[] = [];
  for (const item of items) {
    if (item.graded) {
      continue;
    }
    const overdue = item.dueAt !== null && item.dueAt.getTime() < nowMs;
    if (overdue && todayDayNumber - dayNumber(dueDayOf(item.dueAt!)) > OVERDUE_KEEP_DAYS) {
      continue;
    }
    ranked.push({
      ...item,
      dueDay: item.dueAt === null ? null : dueDayOf(item.dueAt),
      overdue,
      score: scoreOf(item),
    });
  }

  // The day key items actually sort by: overdue work is pulled into today's
  // bucket; everything else keeps its own New York day.
  const sortKeys = new Map<RankedItem, string | null>(
    ranked.map((entry) => [entry, entry.overdue ? todayDay : entry.dueDay]),
  );

  ranked.sort((a, b) => {
    const aSortKey = sortKeys.get(a) ?? null;
    const bSortKey = sortKeys.get(b) ?? null;
    // Overdue-and-today first, then later due days, then items without a due
    // date last.
    const groupOf = (key: string | null) => (key === null ? 2 : 1);
    if (groupOf(aSortKey) !== groupOf(bSortKey)) {
      return groupOf(aSortKey) - groupOf(bSortKey);
    }
    if (aSortKey !== null && bSortKey !== null && aSortKey !== bSortKey) {
      return aSortKey < bSortKey ? -1 : 1;
    }
    const scoreDiff = compareScores(a.score, b.score);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return compareByDueAt(a, b);
  });

  return ranked;
}
