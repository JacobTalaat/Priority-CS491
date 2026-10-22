import type { GradeEngineChoice } from "@/lib/grade-engine";
import type { GradeSetupPayload } from "@/lib/grade-setup";
import { calculatePointsGrade } from "@/lib/points-grade";
import { calculateWeightedGrade, type GradeAssignment, type WeightedGradeResult } from "@/lib/weighted-grade";

export type FinalExamLetterResult =
  | { letter: string; status: "needed"; score: number; percent: number }
  | { letter: string; status: "secured" }
  | { letter: string; status: "out-of-reach"; best: number }
  | { letter: string; status: "unknown" };

export type FinalExamResult =
  | { status: "no-final" }
  | { status: "final-not-gradable" }
  | { status: "already-graded" }
  | { status: "final-not-counted" }
  | { status: "solved"; results: FinalExamLetterResult[]; otherWorkPending: boolean };

export type FinalExamInput = {
  choice: GradeEngineChoice;
  assignments: readonly GradeAssignment[];
  finalAssignmentId: string | null;
  cutoffs: Record<string, number>;
  // The saved setup's weight held outside the categories. No engine reads it,
  // so a final whose weight lives there is invisible to the grade.
  finalExamWeight: number;
};

// Bisection stops once lo and hi are this close, so the reported score is
// never off by more than a hundredth of a point.
const SCORE_PRECISION = 0.01;

// The solver answers "what do I need on the final?" by asking the real grade
// engine hypothetical questions instead of re-deriving its math, so the two
// can never disagree: a needed score fed back into the engine reaches the
// cutoff. The grade only rises as the hypothetical final score rises, which
// is what makes bisection sound.
//
// Assumption: every other ungraded assignment keeps counting the way the
// engine counts it today — ungraded work is left out of both earned and
// possible points, so the rest of the current average holds as-is. If more
// ungraded work is graded later, the real grade can land lower than this
// prediction.
export function solveFinalExam({
  choice,
  assignments,
  finalAssignmentId,
  cutoffs,
  finalExamWeight,
}: FinalExamInput): FinalExamResult {
  const final = finalAssignmentId
    ? assignments.find((assignment) => assignment.id === finalAssignmentId)
    : undefined;
  if (!final) {
    return { status: "no-final" };
  }
  if (!Number.isFinite(final.pointsPossible) || final.pointsPossible <= 0) {
    return { status: "final-not-gradable" };
  }
  const finalScore = final.grade?.score;
  if (typeof finalScore === "number" && Number.isFinite(finalScore)) {
    // The real score exists, so the question is answered; a hypothetical
    // must never override it.
    return { status: "already-graded" };
  }
  // Bisection only means something when the final's score moves the grade.
  // A final weighted outside the categories, or one mapped to no weighted
  // category, is ignored by the engine, so every answer would be a confident
  // "secured" or "out of reach" about an exam that was never counted.
  if (finalExamWeight > 0 || !countsTowardGrade(choice, final)) {
    return { status: "final-not-counted" };
  }

  const gradeWithFinalScore = (score: number): WeightedGradeResult => {
    const hypothetical = assignments.map((assignment) =>
      assignment.id === final.id ? { ...assignment, grade: { score } } : assignment,
    );
    return choice.engine === "weighted"
      ? calculateWeightedGrade(choice.setup, hypothetical)
      : calculatePointsGrade(hypothetical);
  };
  const reaches = (score: number, cutoff: number): boolean => {
    const grade = gradeWithFinalScore(score);
    return grade.status === "calculated" && grade.percentage >= cutoff;
  };

  const results: FinalExamLetterResult[] = [];
  for (const family of ["A", "B", "C"] as const) {
    const target = letterCutoff(cutoffs, family);
    if (!target) {
      continue;
    }
    const { letter, cutoff } = target;
    // A perfect final is the ceiling: if even that misses the cutoff, no
    // score can reach it; if the engine cannot answer at all, say so rather
    // than guess.
    const best = gradeWithFinalScore(final.pointsPossible);
    if (best.status !== "calculated") {
      results.push({ letter, status: "unknown" });
      continue;
    }
    if (reaches(0, cutoff)) {
      results.push({ letter, status: "secured" });
      continue;
    }
    if (best.percentage < cutoff) {
      results.push({ letter, status: "out-of-reach", best: best.percentage });
      continue;
    }

    let lo = 0;
    let hi = final.pointsPossible;
    while (hi - lo > SCORE_PRECISION) {
      const mid = (lo + hi) / 2;
      if (reaches(mid, cutoff)) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    // Both figures round up so the student never under-shoots: entering
    // exactly the reported numbers still reaches the cutoff. Rounding hi up
    // can overshoot an exact threshold by a hundredth, so step back while the
    // lower figure still reaches; and no answer may exceed a perfect final.
    let score = Math.min(Math.ceil(hi * 100) / 100, final.pointsPossible);
    while (score >= SCORE_PRECISION && reaches(roundToCents(score - SCORE_PRECISION), cutoff)) {
      score = roundToCents(score - SCORE_PRECISION);
    }
    const percent = Math.min(Math.ceil((score / final.pointsPossible) * 1000) / 10, 100);
    results.push({ letter, status: "needed", score, percent });
  }

  const otherWorkPending = assignments.some(
    (assignment) =>
      assignment.id !== final.id &&
      !(typeof assignment.grade?.score === "number" && Number.isFinite(assignment.grade.score)) &&
      countsTowardGrade(choice, assignment),
  );
  return { status: "solved", results, otherWorkPending };
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// Whether a score on this assignment can move the grade under the chosen
// engine: it needs points to be graded against and, in a weighted course, a
// mapping to a category that carries weight.
function countsTowardGrade(choice: GradeEngineChoice, assignment: GradeAssignment): boolean {
  if (!Number.isFinite(assignment.pointsPossible) || assignment.pointsPossible <= 0) {
    return false;
  }
  if (choice.engine === "points") {
    return true;
  }
  const weightByCategory = new Map(choice.setup.categories.map((category) => [category.name, category.weight]));
  return choice.setup.assignmentMappings.some(
    (mapping) => mapping.assignmentId === assignment.id && (weightByCategory.get(mapping.category) ?? 0) > 0,
  );
}

// "A" uses the A cutoff when the setup has one. A syllabus that only lists
// A- and A+ still has an A: the lowest cutoff in the family is what it takes
// to get any A, so that one answers the question, under its own label.
function letterCutoff(
  cutoffs: Record<string, number>,
  family: "A" | "B" | "C",
): { letter: string; cutoff: number } | null {
  const exact = cutoffs[family];
  if (typeof exact === "number" && Number.isFinite(exact)) {
    return { letter: family, cutoff: exact };
  }
  let lowest: { letter: string; cutoff: number } | null = null;
  for (const [label, cutoff] of Object.entries(cutoffs)) {
    if ((label === `${family}+` || label === `${family}-`) && Number.isFinite(cutoff)) {
      if (!lowest || cutoff < lowest.cutoff) {
        lowest = { letter: label, cutoff };
      }
    }
  }
  return lowest;
}

// The picked final exam rides in the free-form classDetails JSON, so anything
// that is not a non-empty string reads as "no final picked".
export function readFinalExamAssignmentId(setup: GradeSetupPayload | null): string | null {
  const value = setup?.classDetails.finalExamAssignmentId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function formatPercent(value: number): string {
  return String(Number(value.toFixed(1)));
}

// A best grade just under the cutoff must not print as the cutoff itself
// ("out of reach: brings you to 90%" for a 90 A), so it is cut, never rounded up.
function formatBest(value: number): string {
  return String(Math.floor(value * 10) / 10);
}

// Secured and out of reach are only certain when nothing else is still to be
// graded; otherwise they hold if the rest of the grade stays where it is.
function condition(otherWorkPending: boolean): string {
  return otherWorkPending ? " if your other grades stay where they are" : "";
}

// Letter labels can start with a vowel sound ("A", "A-"), so the article
// that reads aloud correctly has to match.
function article(letter: string): string {
  return /^[AEIOUaeiou]/.test(letter) ? "An" : "A";
}

export function describeFinalExamResult(
  result: FinalExamResult | FinalExamLetterResult,
  otherWorkPending = false,
): string {
  switch (result.status) {
    case "no-final":
      return "Pick which assignment is the final exam for this class to see what you need on it.";
    case "final-not-gradable":
      return "The final exam has no points to grade against, so we can't tell what you would need.";
    case "already-graded":
      return "Your final exam is already graded, so there is nothing left to aim for on it.";
    case "final-not-counted":
      return "Your final exam isn't counted in your grade setup yet. Give it its own category with its weight to see what you need on it.";
    case "solved":
      if (result.results.length === 0) {
        return "No letter grades are set up for this class, so there is nothing to aim for yet.";
      }
      return result.results.map((entry) => describeFinalExamResult(entry, result.otherWorkPending)).join(" ");
    case "needed":
      return `You need ${formatPercent(result.percent)}% on the final for ${article(result.letter).toLowerCase()} ${result.letter}${condition(otherWorkPending)}.`;
    case "secured":
      return `You have ${article(result.letter).toLowerCase()} ${result.letter} secured even with a 0 on the final${condition(otherWorkPending)}.`;
    case "out-of-reach":
      return `${article(result.letter)} ${result.letter} is out of reach${condition(otherWorkPending)}: a perfect final brings you to ${formatBest(result.best)}%.`;
    case "unknown":
      return `We can't tell yet what you would need on the final for ${article(result.letter).toLowerCase()} ${result.letter}.`;
  }
}
