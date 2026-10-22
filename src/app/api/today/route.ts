import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { withReasons } from "@/lib/item-reason";
import { loadOpenWork } from "@/lib/ranking-data";
import type { RankedItem } from "@/lib/ranking";

export const dynamic = "force-dynamic";

// Half an hour to a full day's worth of work; anything else is not a plan.
const MIN_HOURS = 0.5;
const MAX_HOURS = 12;

// The same one-hour default the ranking divides by for an unestimated item, so
// a planned list does not bill an item differently than the scored list does.
const DEFAULT_HOURS = 1;

// Sums like 0.5 + 1.75 + 0.75 land one ULP over 3 in floating point, so a
// budget check allows that much drift to still count a fitting item.
const HOURS_TOLERANCE = 1e-9;

type TodayItem = RankedItem & { reason: string; rank: number; estimated: boolean };

function isPositiveHours(hours: number | null): boolean {
  return typeof hours === "number" && Number.isFinite(hours) && hours > 0;
}

function costOf(item: TodayItem): number {
  return item.estimated ? item.hours! : DEFAULT_HOURS;
}

function todayItemJson(item: TodayItem) {
  return {
    rank: item.rank,
    assignmentId: item.assignmentId,
    courseId: item.courseId,
    courseName: item.courseName,
    title: item.title,
    dueAt: item.dueAt ? item.dueAt.toISOString() : null,
    dueDay: item.dueDay,
    overdue: item.overdue,
    share: item.share,
    hours: item.hours,
    estimated: item.estimated,
    score: item.score,
    reason: item.reason,
    boundary: item.boundary,
  };
}

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const values = new URL(request.url).searchParams.getAll("hours");
  if (values.length > 1) {
    return NextResponse.json({ error: "Hours filter must be a number between 0.5 and 12." }, { status: 400 });
  }
  let hours: number | null = null;
  if (values.length === 1) {
    const parsed = Number(values[0]);
    if (!Number.isFinite(parsed) || parsed < MIN_HOURS || parsed > MAX_HOURS) {
      return NextResponse.json({ error: "Hours filter must be a number between 0.5 and 12." }, { status: 400 });
    }
    hours = parsed;
  }

  const now = new Date();
  const ranked = withReasons(await loadOpenWork(user.id, now), now);

  // Ranks are positions in the full ranked list, assigned before any filtering:
  // a filtered plan keeps them so both clients point at the same item.
  const items: TodayItem[] = ranked.map((item, index) => ({
    ...item,
    rank: index + 1,
    estimated: isPositiveHours(item.hours),
  }));

  if (hours === null) {
    return NextResponse.json({ generatedAt: now.toISOString(), items: items.map(todayItemJson), hoursFilter: null });
  }

  // Fill the budget in ranked order and skip anything that would blow it, so a
  // smaller item further down the list still fits; ranks are never renumbered.
  let plannedHours = 0;
  let unestimatedCount = 0;
  let skippedCount = 0;
  const kept: TodayItem[] = [];
  for (const item of items) {
    const cost = costOf(item);
    if (plannedHours + cost > hours + HOURS_TOLERANCE) {
      skippedCount += 1;
      continue;
    }
    plannedHours += cost;
    if (!item.estimated) {
      unestimatedCount += 1;
    }
    kept.push(item);
  }

  return NextResponse.json({
    generatedAt: now.toISOString(),
    items: kept.map(todayItemJson),
    hoursFilter: { hours, plannedHours, unestimatedCount, skippedCount },
  });
}
