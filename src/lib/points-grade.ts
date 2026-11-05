import { roundPercentage, type GradeAssignment, type WeightedGradeResult } from "@/lib/weighted-grade";

export type PointsGradeResult = WeightedGradeResult;

export function calculatePointsGrade(assignments: readonly GradeAssignment[]): PointsGradeResult {
  let earned = 0;
  let possible = 0;

  for (const assignment of assignments) {
    const score = assignment.grade?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      continue;
    }
    if (score < 0) {
      return { status: "unsupported", reason: "negative-score" };
    }
    // Canvas rules: a score above points possible counts as-is; a positive
    // score on a 0-point assignment is pure bonus that adds to earned only.
    if (!Number.isFinite(assignment.pointsPossible) || assignment.pointsPossible <= 0) {
      if (score > 0) {
        earned += score;
      }
      continue;
    }
    earned += score;
    possible += assignment.pointsPossible;
  }

  if (!Number.isFinite(earned) || !Number.isFinite(possible)) {
    return { status: "unsupported", reason: "non-finite-result" };
  }
  if (possible === 0) {
    return { status: "insufficient-data" };
  }
  const percentage = (earned / possible) * 100;
  if (!Number.isFinite(percentage)) {
    return { status: "unsupported", reason: "non-finite-result" };
  }
  return { status: "calculated", percentage: roundPercentage(percentage) };
}
