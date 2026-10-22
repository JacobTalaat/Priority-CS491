import { chooseGradeEngine } from "@/lib/grade-engine";
import type { GradeSetupPayload } from "@/lib/grade-setup";
import { roundPercentage, type GradeAssignment } from "@/lib/weighted-grade";

export type AssignmentShare = {
  assignmentId: string;
  share: number | null;
  category: string | null;
};

// Takes the saved setup rather than an engine choice so it picks the engine the
// same way the grade route does and still sees finalExamWeight, which the
// engine choice drops.
export function assignmentShares(
  setup: GradeSetupPayload | null,
  assignments: readonly GradeAssignment[],
): AssignmentShare[] {
  // A final exam weight held outside the categories belongs to no assignment,
  // so every share computed without it would be confidently wrong: a 70/30
  // course would rank its final as a slice of Homework. Unknown is the honest
  // answer until the final is its own category.
  if (setup && setup.finalExamWeight > 0) {
    return assignments.map((assignment) => ({ assignmentId: assignment.id, share: null, category: null }));
  }
  const choice = chooseGradeEngine(setup);
  return choice.engine === "weighted" ? weightedShares(choice.setup, assignments) : pointsShares(assignments);
}

// A null share means the assignment sits outside the grading math entirely
// (unmapped, or mapped to a category carrying no weight); a 0 share means it
// is inside the math but carries no points, so it cannot move the grade.
function weightedShares(setup: GradeSetupPayload, assignments: readonly GradeAssignment[]): AssignmentShare[] {
  const assignmentsById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const categoriesByName = new Map(setup.categories.map((category) => [category.name, category]));
  const categoryByAssignmentId = new Map<string, string>();
  for (const mapping of setup.assignmentMappings) {
    if (categoriesByName.has(mapping.category) && !categoryByAssignmentId.has(mapping.assignmentId)) {
      categoryByAssignmentId.set(mapping.assignmentId, mapping.category);
    }
  }

  // The category total counts every mapped assignment, graded or not: a share
  // is a slice of the final grade, so an absent grade does not shrink the
  // other assignments' slices.
  const totalsByCategory = new Map<string, number>();
  for (const [assignmentId, categoryName] of categoryByAssignmentId) {
    const assignment = assignmentsById.get(assignmentId);
    if (assignment && Number.isFinite(assignment.pointsPossible) && assignment.pointsPossible > 0) {
      totalsByCategory.set(categoryName, (totalsByCategory.get(categoryName) ?? 0) + assignment.pointsPossible);
    }
  }

  return assignments.map((assignment) => {
    const categoryName = categoryByAssignmentId.get(assignment.id);
    if (!categoryName) {
      return { assignmentId: assignment.id, share: null, category: null };
    }
    const category = categoriesByName.get(categoryName);
    if (!category || category.weight <= 0) {
      return { assignmentId: assignment.id, share: null, category: categoryName };
    }
    const categoryTotal = totalsByCategory.get(categoryName) ?? 0;
    const share =
      Number.isFinite(assignment.pointsPossible) && assignment.pointsPossible > 0 && categoryTotal > 0
        ? (assignment.pointsPossible / categoryTotal) * category.weight
        : 0;
    return { assignmentId: assignment.id, share: roundPercentage(share), category: categoryName };
  });
}

function pointsShares(assignments: readonly GradeAssignment[]): AssignmentShare[] {
  let total = 0;
  for (const assignment of assignments) {
    if (Number.isFinite(assignment.pointsPossible) && assignment.pointsPossible > 0) {
      total += assignment.pointsPossible;
    }
  }

  return assignments.map((assignment) => {
    if (!(total > 0)) {
      return { assignmentId: assignment.id, share: null, category: null };
    }
    if (!Number.isFinite(assignment.pointsPossible) || assignment.pointsPossible <= 0) {
      return { assignmentId: assignment.id, share: 0, category: null };
    }
    return {
      assignmentId: assignment.id,
      share: roundPercentage((assignment.pointsPossible / total) * 100),
      category: null,
    };
  });
}
