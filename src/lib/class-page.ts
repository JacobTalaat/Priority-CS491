import type { CategoryBreakdown } from "./grade-engine";
import type { UnsupportedReason, WeightedGradeResult } from "./weighted-grade";

// The student is at NJIT, so due dates read in campus time.
const dueFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
});

const percentFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const pointsFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatPercent(value: number): string {
  return `${percentFormatter.format(value)}%`;
}

const UNSUPPORTED_REASONS: Record<UnsupportedReason, string> = {
  "unsupported-rule": "This class has a grading rule (like a dropped score, curve, or late penalty) that Priority can't grade yet.",
  "extra-credit": "A score is above its points possible (extra credit), which Priority can't grade yet.",
  "negative-score": "A grade below zero is stored for this class.",
  "non-finite-result": "The grade math didn't produce a usable number.",
};

// The big number at the top of the class page, plus a sentence when there is no number.
export function gradeSummary(grade: WeightedGradeResult): { headline: string; detail: string | null } {
  if (grade.status === "calculated") {
    return { headline: formatPercent(grade.percentage), detail: null };
  }
  if (grade.status === "insufficient-data") {
    return { headline: "No grade yet", detail: "Nothing in this class is graded enough to work out a grade." };
  }
  return {
    headline: "Can't work out a grade",
    detail: UNSUPPORTED_REASONS[grade.reason] ?? "This class uses a grading rule Priority can't calculate.",
  };
}

// One category line in the breakdown, e.g. "81% · 81 of 100 points · 2 graded, 1 to go".
export function categoryLine(category: CategoryBreakdown): string {
  if (category.percentage === null) {
    return category.ungradedCount > 0
      ? `Nothing graded yet · ${category.ungradedCount} to go`
      : "No assignments in this category";
  }
  const parts = [
    formatPercent(category.percentage),
    `${pointsFormatter.format(category.pointsEarned)} of ${pointsFormatter.format(category.pointsPossible)} points`,
  ];
  parts.push(category.ungradedCount > 0 ? `${category.gradedCount} graded, ${category.ungradedCount} to go` : `${category.gradedCount} graded`);
  return parts.join(" · ");
}

export function scoreText(grade: { score: number | null } | null, pointsPossible: number): string {
  if (!grade || grade.score === null) {
    return "Not graded";
  }
  const score = pointsFormatter.format(grade.score);
  return pointsPossible > 0 ? `${score} / ${pointsFormatter.format(pointsPossible)}` : `${score} pts`;
}

export function dueText(dueAt: string | null, hasDueDate: boolean): string {
  if (!hasDueDate || !dueAt) {
    return "No due date";
  }
  const date = new Date(dueAt);
  return Number.isNaN(date.getTime()) ? "No due date" : `Due ${dueFormatter.format(date)}`;
}

// "Worth 20% of your grade"; nothing when the assignment sits outside the grading math.
export function shareText(share: number | null | undefined): string | null {
  if (share === null || share === undefined) {
    return null;
  }
  return `Worth ${formatPercent(share)} of your grade`;
}
