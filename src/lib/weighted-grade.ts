import type { GradeSetupPayload } from "@/lib/grade-setup";

export type GradeAssignment = { id: string; pointsPossible: number; grade: { score: number | null } | null };

export type UnsupportedReason = "negative-score" | "non-finite-result";

export type WeightedGradeResult =
  | { status: "calculated"; percentage: number }
  | { status: "insufficient-data" }
  | { status: "unsupported"; reason: UnsupportedReason };

const PERCENTAGE_DECIMAL_PLACES = 10;

export function roundPercentage(value: number): number {
  const factor = 10 ** PERCENTAGE_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

export function calculateWeightedGrade(
  setup: GradeSetupPayload,
  assignments: readonly GradeAssignment[],
): WeightedGradeResult {
  const assignmentsById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const categoriesByName = new Map(setup.categories.map((category) => [category.name, category]));
  const totalsByCategory = new Map<string, { earned: number; possible: number }>();

  for (const mapping of setup.assignmentMappings) {
    const assignment = assignmentsById.get(mapping.assignmentId);
    if (!assignment || !categoriesByName.has(mapping.category)) {
      continue;
    }
    const score = assignment.grade?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      continue;
    }
    if (score < 0) {
      return { status: "unsupported", reason: "negative-score" };
    }
    // Canvas rules: a score above points possible counts as-is, so extra
    // credit can lift a category above 100; a positive score on a 0-point
    // assignment is pure bonus that adds to earned only.
    if (!Number.isFinite(assignment.pointsPossible) || assignment.pointsPossible <= 0) {
      if (score > 0) {
        const totals = totalsByCategory.get(mapping.category) ?? { earned: 0, possible: 0 };
        totals.earned += score;
        totalsByCategory.set(mapping.category, totals);
      }
      continue;
    }

    const totals = totalsByCategory.get(mapping.category) ?? { earned: 0, possible: 0 };
    totals.earned += score;
    totals.possible += assignment.pointsPossible;
    totalsByCategory.set(mapping.category, totals);
  }

  let weightedPercentage = 0;
  let totalWeight = 0;

  for (const [name, totals] of totalsByCategory) {
    const category = categoriesByName.get(name);
    if (!category || totals.possible <= 0 || category.weight <= 0) {
      continue;
    }
    const categoryPercentage = (totals.earned / totals.possible) * 100;
    weightedPercentage += categoryPercentage * category.weight;
    totalWeight += category.weight;
  }

  if (totalWeight === 0) {
    return { status: "insufficient-data" };
  }

  const percentage = weightedPercentage / totalWeight;
  if (!Number.isFinite(percentage)) {
    return { status: "unsupported", reason: "non-finite-result" };
  }
  return { status: "calculated", percentage: roundPercentage(percentage) };
}
