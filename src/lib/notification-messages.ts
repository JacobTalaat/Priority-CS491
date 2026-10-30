import type { RankedItem } from "@/lib/ranking";

export type NotificationPreferences = {
  notifyTonight: boolean;
  notifyGradePosted: boolean;
  notifyDueTomorrow: boolean;
};

export type GradePostedInput = {
  assignmentTitle: string;
  courseName: string;
  score: number;
  pointsPossible: number | null;
};

export type NotificationMessage = {
  kind: "tonight" | "due-tomorrow" | "grade-posted";
  title: string;
  body: string;
  url: string;
};

// Push payloads carry the body verbatim, and both web push and APNs cap the
// alert length well below 160 characters.
const BODY_LIMIT = 160;

// en-CA formats Gregorian dates as YYYY-MM-DD, same key ranking.ts uses, so
// the messages agree with the ranked list on which New York day it is.
const NY_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DAY_MS = 24 * 60 * 60 * 1000;

function nyDayOf(date: Date): string {
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

// Cuts by code point, never inside an emoji's surrogate pair, and marks the cut.
function truncate(text: string, maxLength: number): string {
  const points = Array.from(text);
  if (points.length <= maxLength) {
    return text;
  }
  return `${points.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

// Course names sit in the fixed part of every body, so they are capped before the
// titles are fitted; otherwise one long course name alone could pass the limit.
const COURSE_NAME_LIMIT = 40;

function course(name: string): string {
  return truncate(name, COURSE_NAME_LIMIT);
}

// The last guard: whatever the inputs, a body never reaches the push limit.
function bounded(body: string): string {
  return Array.from(body).length < BODY_LIMIT ? body : truncate(body, BODY_LIMIT - 1);
}

// A list reads as "A, B and C" — comma separators everywhere except the last
// "and", without an Oxford comma.
function joinNames(list: string[]): string {
  if (list.length <= 1) {
    return list.join("");
  }
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// Shortens the longest name with an ellipsis until the composed body fits,
// so a long title is cut before any useful text is dropped entirely.
function fitNames(prefix: string, suffix: string, names: string[]): string[] {
  const compose = (list: string[]): string => prefix + joinNames(list) + suffix;
  const fitted = [...names];
  while (compose(fitted).length >= BODY_LIMIT) {
    let longest = 0;
    for (let i = 1; i < fitted.length; i += 1) {
      if (fitted[i].length > fitted[longest].length) {
        longest = i;
      }
    }
    const overBy = compose(fitted).length - (BODY_LIMIT - 1);
    const cut = Math.max(1, fitted[longest].length - overBy - 1);
    const shortened = truncate(fitted[longest], cut + 1);
    if (shortened === fitted[longest]) {
      break;
    }
    fitted[longest] = shortened;
  }
  return fitted;
}

function formatNumber(value: number): string {
  // 18 -> "18", 18.5 -> "18.5", 18.3333 -> "18.33": at most two decimals and no
  // trailing zeros, so a computed value never prints its floating-point tail.
  return String(Math.round(value * 100) / 100);
}

// The same wording as the reason next to each ranked item: whole percents, and a
// real slice too small to round to 1 still says so instead of "0 percent".
function shareClause(share: number | null): string {
  if (typeof share !== "number" || !Number.isFinite(share) || share <= 0) {
    return "";
  }
  const whole = Math.round(share);
  return whole >= 1 ? `, ${whole} percent of your grade` : ", under 1 percent of your grade";
}

function tonightBody(item: RankedItem, duePhrase: string): string {
  const suffix = ` (${course(item.courseName)}) — ${duePhrase}${shareClause(item.share)}.`;
  const [title] = fitNames("Start with ", suffix, [item.title]);
  return bounded(`Start with ${title}${suffix}`);
}

// The item Tonight names: the first ranked item that is overdue or due today
// or tomorrow in New York. Shared with messagesFor so the duplicate-suppression
// rule looks at exactly the item tonightMessage picks, and the two cannot drift.
function tonightPick(ranked: readonly RankedItem[], now: Date): RankedItem | undefined {
  const today = nyDayOf(now);
  const tomorrowNumber = dayNumber(today) + 1;
  return ranked.find(
    (item) =>
      item.overdue ||
      item.dueDay === today ||
      (item.dueDay !== null && dayNumber(item.dueDay) === tomorrowNumber),
  );
}

// Every ranked item whose New York due day is tomorrow, in ranked order.
// Shared for the same reason: dueTomorrowMessage and messagesFor count the
// same list, so the dedup rule checks the real due-tomorrow population.
function itemsDueTomorrow(ranked: readonly RankedItem[], now: Date): RankedItem[] {
  const tomorrowNumber = dayNumber(nyDayOf(now)) + 1;
  return ranked.filter(
    (item) => item.dueDay !== null && dayNumber(item.dueDay) === tomorrowNumber,
  );
}

export function tonightMessage(ranked: readonly RankedItem[], now: Date): NotificationMessage | null {
  const top = tonightPick(ranked, now);
  if (!top) {
    return null;
  }
  const today = nyDayOf(now);
  const duePhrase = top.overdue
    ? "overdue"
    : top.dueDay === today
      ? "due today"
      : "due tomorrow";
  return {
    kind: "tonight",
    title: "Tonight",
    body: tonightBody(top, duePhrase),
    url: "/today",
  };
}

export function dueTomorrowMessage(ranked: readonly RankedItem[], now: Date): NotificationMessage | null {
  const due = itemsDueTomorrow(ranked, now);
  if (due.length === 0) {
    return null;
  }
  let body: string;
  if (due.length === 1) {
    const suffix = ` (${course(due[0].courseName)}) is due tomorrow.`;
    const [title] = fitNames("", suffix, [due[0].title]);
    body = bounded(`${title}${suffix}`);
  } else {
    // The push names the total up front but lists at most three titles, so a
    // heavy day still reads as one short sentence.
    const listed = due.slice(0, 3).map((item) => item.title);
    const extra = due.length - listed.length;
    if (extra > 0) {
      listed.push(`${extra} more`);
    }
    const prefix = `${due.length} things are due tomorrow: `;
    body = bounded(prefix + joinNames(fitNames(prefix, ".", listed)) + ".");
  }
  return {
    kind: "due-tomorrow",
    title: "Due tomorrow",
    body,
    url: "/today",
  };
}

export function gradePostedMessage(input: GradePostedInput): NotificationMessage {
  const score = formatNumber(input.score);
  const points =
    typeof input.pointsPossible === "number" &&
    Number.isFinite(input.pointsPossible) &&
    input.pointsPossible > 0
      ? `/${formatNumber(input.pointsPossible)}`
      : "";
  const suffix = ` (${course(input.courseName)}) — ${score}${points}.`;
  const [title] = fitNames("Grade posted: ", suffix, [input.assignmentTitle]);
  return {
    kind: "grade-posted",
    title: "Grade posted",
    body: bounded(`Grade posted: ${title}${suffix}`),
    url: "/classes",
  };
}

export function messagesFor(
  preferences: NotificationPreferences,
  inputs: {
    ranked: readonly RankedItem[];
    now: Date;
    gradePosted?: GradePostedInput | null;
  },
): NotificationMessage[] {
  const { ranked, now } = inputs;
  const messages: NotificationMessage[] = [];
  const tonight = preferences.notifyTonight ? tonightMessage(ranked, now) : null;
  if (tonight) {
    messages.push(tonight);
  }
  if (preferences.notifyDueTomorrow) {
    const dueTomorrow = dueTomorrowMessage(ranked, now);
    // When Tonight's pick is the only item due tomorrow, the Due tomorrow push
    // would repeat the same fact, so it is dropped. A second due-tomorrow item
    // earns it back, and so does Tonight naming overdue or due-today work —
    // that pick is not due tomorrow at all. With Tonight off, the Due tomorrow
    // message is still sent for the single item.
    const due = itemsDueTomorrow(ranked, now);
    const repeatsTonight = tonight !== null && due.length === 1 && due[0] === tonightPick(ranked, now);
    if (dueTomorrow && !repeatsTonight) {
      messages.push(dueTomorrow);
    }
  }
  // A graded post is its own event: the ranked list skips graded work, so the
  // grade message is built from its own input rather than from the list.
  if (preferences.notifyGradePosted && inputs.gradePosted) {
    messages.push(gradePostedMessage(inputs.gradePosted));
  }
  return messages;
}
