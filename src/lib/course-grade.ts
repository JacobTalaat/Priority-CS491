import { parseGradeSetup } from "./grade-setup";

export type CourseGradeAssignment = {
  id: string;
  pointsPossible: number;
  score: number | null;
};

export type CourseGradeCategory = {
  name: string;
  weight: number;
  grade: number | null;
};

export type CourseGradeResult =
  | {
      supported: false;
      currentGrade: null;
      categories: [];
      message: string;
    }
  | {
      supported: true;
      currentGrade: number | null;
      categories: CourseGradeCategory[];
      message: string | null;
    };

export function calculateCourseGrade(setupValue: unknown, assignments: CourseGradeAssignment[]): CourseGradeResult {
  const parsed = parseGradeSetup(setupValue);
  if (!parsed.ok) {
    return {
      supported: false,
      currentGrade: null,
      categories: [],
      message: "Confirm a valid grade setup to calculate this grade.",
    };
  }

  const assignmentIds = new Set(assignments.map((assignment) => assignment.id));
  const mappingByAssignment = new Map(
    parsed.data.assignmentMappings.map((mapping) => [mapping.assignmentId, mapping.category]),
  );
  if (
    mappingByAssignment.size !== assignmentIds.size ||
    assignments.some((assignment) => !mappingByAssignment.has(assignment.id)) ||
    [...mappingByAssignment.keys()].some((assignmentId) => !assignmentIds.has(assignmentId))
  ) {
    return {
      supported: false,
      currentGrade: null,
      categories: [],
      message: "Update the confirmed setup to map every current assignment.",
    };
  }

  const totalsByCategory = new Map<string, { earned: number; possible: number }>();
  for (const category of parsed.data.categories) {
    totalsByCategory.set(category.name, { earned: 0, possible: 0 });
  }

  for (const assignment of assignments) {
    if (
      assignment.score === null ||
      !Number.isFinite(assignment.score) ||
      !Number.isFinite(assignment.pointsPossible) ||
      assignment.pointsPossible <= 0
    ) {
      continue;
    }
    const categoryName = mappingByAssignment.get(assignment.id);
    if (!categoryName) {
      continue;
    }
    const totals = totalsByCategory.get(categoryName);
    if (totals) {
      totals.earned += assignment.score;
      totals.possible += assignment.pointsPossible;
    }
  }

  const categories = parsed.data.categories.map(({ name, weight }) => {
    const totals = totalsByCategory.get(name)!;
    return {
      name,
      weight,
      grade: totals.possible > 0 ? (totals.earned / totals.possible) * 100 : null,
    };
  });
  const gradedCategories = categories.filter((category) => category.grade !== null && category.weight > 0);
  const totalWeight = gradedCategories.reduce((total, category) => total + category.weight, 0);
  if (totalWeight === 0) {
    return {
      supported: true,
      currentGrade: null,
      categories,
      message: "No weighted graded work yet.",
    };
  }

  const weightedGrade = gradedCategories.reduce(
    (total, category) => total + (category.grade ?? 0) * category.weight,
    0,
  );
  return {
    supported: true,
    currentGrade: weightedGrade / totalWeight,
    categories,
    message: null,
  };
}
