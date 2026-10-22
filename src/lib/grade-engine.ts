import type { GradeSetupPayload } from "@/lib/grade-setup";
import { roundPercentage, type GradeAssignment } from "@/lib/weighted-grade";

export type GradeEngineChoice =
  | { engine: "weighted"; setup: GradeSetupPayload }
  | { engine: "points"; setup: null };

export type CategoryBreakdown = {
  category: string;
  weight: number;
  percentage: number | null;
  pointsEarned: number;
  pointsPossible: number;
  gradedCount: number;
  ungradedCount: number;
};

// A weighted grade needs at least one category with a real weight; a setup
// whose weights are all zero or unusable can only fall back to points.
export function hasUsableCategoryWeights(setup: GradeSetupPayload): boolean {
  return setup.categories.some((category) => Number.isFinite(category.weight) && category.weight > 0);
}

// No confirmed setup, or one whose categories carry no usable weight, means
// the weighted math is impossible, so the points engine is the only one left.
export function chooseGradeEngine(setup: GradeSetupPayload | null): GradeEngineChoice {
  if (setup && hasUsableCategoryWeights(setup)) {
    return { engine: "weighted", setup };
  }
  return { engine: "points", setup: null };
}

// The accumulation mirrors calculateWeightedGrade guard for guard so that the
// per-category figures compose back into the overall percentage it returns.
// percentage is null when a category has nothing graded yet; 0 means graded
// and exactly zero points, which are different facts to a student.
export function buildCategoryBreakdown(
  setup: GradeSetupPayload,
  assignments: readonly GradeAssignment[],
): CategoryBreakdown[] {
  const assignmentsById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  return setup.categories.map((category) => {
    let pointsEarned = 0;
    let pointsPossible = 0;
    let gradedCount = 0;
    let ungradedCount = 0;

    for (const mapping of setup.assignmentMappings) {
      if (mapping.category !== category.name) {
        continue;
      }
      const assignment = assignmentsById.get(mapping.assignmentId);
      if (!assignment) {
        continue;
      }
      const score = assignment.grade?.score;
      if (typeof score !== "number" || !Number.isFinite(score)) {
        ungradedCount += 1;
        continue;
      }
      if (score < 0) {
        continue;
      }
      if (!Number.isFinite(assignment.pointsPossible) || assignment.pointsPossible <= 0) {
        if (score > 0) {
          continue;
        }
        continue;
      }
      if (score > assignment.pointsPossible) {
        continue;
      }
      gradedCount += 1;
      pointsEarned += score;
      pointsPossible += assignment.pointsPossible;
    }

    return {
      category: category.name,
      weight: category.weight,
      percentage: pointsPossible > 0 ? roundPercentage((pointsEarned / pointsPossible) * 100) : null,
      pointsEarned,
      pointsPossible,
      gradedCount,
      ungradedCount,
    };
  });
}
