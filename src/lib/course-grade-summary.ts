import type { GradeSetupPayload } from "@/lib/grade-setup";
import type { GradeAssignment } from "@/lib/weighted-grade";

export type GradeCategorySummary = {
  name: string;
  weight: number;
  percentage: number | null;
};

export function categoryGradeSummaries(
  setup: GradeSetupPayload,
  assignments: readonly GradeAssignment[],
): GradeCategorySummary[] {
  const assignmentsById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const totalsByCategory = new Map<string, { earned: number; possible: number }>();

  for (const mapping of setup.assignmentMappings) {
    const assignment = assignmentsById.get(mapping.assignmentId);
    const score = assignment?.grade?.score;
    if (
      !assignment ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0 ||
      !Number.isFinite(assignment.pointsPossible) ||
      assignment.pointsPossible <= 0 ||
      score > assignment.pointsPossible
    ) {
      continue;
    }

    const totals = totalsByCategory.get(mapping.category) ?? { earned: 0, possible: 0 };
    totals.earned += score;
    totals.possible += assignment.pointsPossible;
    totalsByCategory.set(mapping.category, totals);
  }

  return setup.categories.map((category) => {
    const totals = totalsByCategory.get(category.name);
    return {
      name: category.name,
      weight: category.weight,
      percentage: totals && totals.possible > 0 ? (totals.earned / totals.possible) * 100 : null,
    };
  });
}
