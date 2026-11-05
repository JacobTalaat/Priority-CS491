import { describeFinalExamResult, type FinalExamLetterResult, type FinalExamResult } from "./final-exam-solver";
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
// A null percentage means no graded points to divide by, but bonus points can
// still have been earned there.
export function categoryLine(category: CategoryBreakdown): string {
  if (category.percentage === null) {
    if (category.pointsEarned > 0) {
      const parts = [
        `${pointsFormatter.format(category.pointsEarned)} bonus points`,
        category.ungradedCount > 0
          ? `${category.gradedCount} graded, ${category.ungradedCount} to go`
          : `${category.gradedCount} graded`,
      ];
      return parts.join(" · ");
    }
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

export type FinalExamRow = { letter: string; sentence: string; badge: string };

// One row per letter the solver answered, worded by the solver itself so the page and any
// other client say exactly the same thing.
export function finalExamRows(finalExam: FinalExamResult): FinalExamRow[] {
  if (finalExam.status !== "solved") {
    return [];
  }
  return finalExam.results.map((result) => ({
    letter: result.letter,
    sentence: describeFinalExamResult(result, finalExam.otherWorkPending),
    badge: finalExamBadge(result),
  }));
}

function finalExamBadge(result: FinalExamLetterResult): string {
  switch (result.status) {
    case "needed":
      return `Need ${formatPercent(result.percent)}`;
    case "secured":
      return "Secured";
    case "out-of-reach":
      return "Out of reach";
    case "unknown":
      return "Can't tell yet";
  }
}

// When an A (or the lowest A the setup has, like A-) can't be reached, say so up front and
// point at the best letter that still can be, so the news comes with something to aim for.
export function finalExamOutOfReachNotice(finalExam: FinalExamResult): string | null {
  if (finalExam.status !== "solved") {
    return null;
  }
  const a = finalExam.results.find((result) => /^A/.test(result.letter));
  if (!a || a.status !== "out-of-reach") {
    return null;
  }
  const headline = describeFinalExamResult(a, finalExam.otherWorkPending);
  const reachable = finalExam.results.find((result) => result.status === "needed" || result.status === "secured");
  return reachable ? `${headline} ${describeFinalExamResult(reachable, finalExam.otherWorkPending)}` : headline;
}
