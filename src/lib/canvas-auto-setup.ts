import { parseGradeSetup, type GradeSetupPayload } from "@/lib/grade-setup";
import {
  canvasWeightsAvailable,
  resolveWeightPrecedence,
  type CanvasAssignment,
  type CanvasGroup,
} from "@/lib/weight-precedence";

export type CanvasAutoSetupGroup = CanvasGroup & {
  // True when the group carries a drop rule the grade engine cannot apply.
  hasDropRules: boolean;
};

export type CanvasAutoSetupInput = {
  applyGroupWeights: boolean;
  // Canvas assignment groups in position order.
  groups: CanvasAutoSetupGroup[];
  assignments: CanvasAssignment[];
};

// The confirmed setup Canvas already implies: a course that grades by weighted
// groups, every group carrying a finite weight that totals 100, every
// assignment sitting in one of those groups, and no drop rules or duplicate
// group names the engine would grade differently than Canvas. Anything short of
// that is null and the student confirms by hand as before.
export function buildCanvasSetup(input: CanvasAutoSetupInput): GradeSetupPayload | null {
  if (!input.applyGroupWeights || !canvasWeightsAvailable(input.groups)) {
    return null;
  }
  if (input.groups.some((group) => group.hasDropRules)) {
    return null;
  }
  const groupNames = new Set<string>();
  for (const group of input.groups) {
    const key = group.name.trim().toLowerCase();
    // Two same-named groups at 50% each pool their points inside one category,
    // which grades differently than Canvas's per-group averaging.
    if (groupNames.has(key)) {
      return null;
    }
    groupNames.add(key);
  }
  for (const assignment of input.assignments) {
    if (
      assignment.groupName === null ||
      !groupNames.has(assignment.groupName.trim().toLowerCase())
    ) {
      return null;
    }
  }
  const resolved = resolveWeightPrecedence({
    current: { categories: [], assignmentMappings: {}, finalExamWeight: "0" },
    suggestedCategories: [],
    suggestedFinalExamWeight: null,
    canvasGroups: input.groups,
    canvasAssignments: input.assignments,
  });
  const candidate = {
    categories: resolved.categories.map((category) => ({
      name: category.name,
      weight: Number(category.weight),
    })),
    assignmentMappings: Object.entries(resolved.assignmentMappings).map(
      ([assignmentId, category]) => ({ assignmentId, category }),
    ),
    finalExamWeight: Number(resolved.finalExamWeight),
    cutoffs: {},
    classDetails: {},
    unsupportedRules: [],
  };
  // Never write a setup the confirm route would reject, for example a group
  // whose name is blank after trimming.
  const parsed = parseGradeSetup(candidate);
  return parsed.ok ? { ...parsed.data, unsupportedRules: [] } : null;
}
