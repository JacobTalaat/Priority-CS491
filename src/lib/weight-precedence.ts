// Which grade weights win when both Canvas and a syllabus read have an answer: the
// professor's Canvas group weights outrank a syllabus read, and the syllabus fills only
// what Canvas leaves out.

export type CanvasGroup = { name: string; groupWeight: number | null };

export type WeightedCategory = { name: string; weight: string };

export type SuggestedCategory = { name: string; weight: number | null };

export type CanvasAssignment = { id: string; groupName: string | null };

export type WeightPrecedenceInput = {
  // The form state the syllabus read lands on, before any of its suggestions are applied.
  current: {
    categories: WeightedCategory[];
    assignmentMappings: Record<string, string>;
    finalExamWeight: string;
  };
  suggestedCategories: SuggestedCategory[];
  suggestedFinalExamWeight: number | null;
  // The selected course's Canvas assignment groups and its assignments (group name only).
  // Groups must be given in Canvas order; the grade-setups API already orders them by
  // position, so the order received is the order applied.
  canvasGroups: CanvasGroup[];
  canvasAssignments: CanvasAssignment[];
};

export type WeightPrecedenceResult = {
  categories: WeightedCategory[];
  assignmentMappings: Record<string, string>;
  finalExamWeight: string;
  // True when Canvas weights were kept and the syllabus suggested different ones, so the
  // read's success message can say which source won.
  canvasKept: boolean;
};

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

// The weight as Canvas stated it: null means Canvas gave no weight and a non-finite number
// (the API should not send one, but the display gate guards it) counts as unstated too.
function statedCanvasWeight(group: CanvasGroup): number | null {
  return group.groupWeight !== null && Number.isFinite(group.groupWeight) ? group.groupWeight : null;
}

// A Canvas group counts as weighted only for a finite number greater than zero: Canvas
// reports group_weight 0 for every group on courses that do not grade by group, so a 0
// says nothing about the professor's weights.
function positiveCanvasWeight(group: CanvasGroup): number {
  const weight = statedCanvasWeight(group);
  return weight !== null && weight > 0 ? weight : 0;
}

function hasAnyCanvasWeight(groups: CanvasGroup[]): boolean {
  return groups.some((group) => positiveCanvasWeight(group) > 0);
}

export function canvasWeightsAvailable(groups: CanvasGroup[]): boolean {
  return (
    groups.length > 0 &&
    groups.every((group) => group.groupWeight !== null && Number.isFinite(group.groupWeight)) &&
    Math.abs(groups.reduce((sum, group) => sum + (group.groupWeight ?? 0), 0) - 100) <= 0.001
  );
}

export function resolveWeightPrecedence(input: WeightPrecedenceInput): WeightPrecedenceResult {
  const { current, suggestedCategories, suggestedFinalExamWeight, canvasGroups, canvasAssignments } =
    input;

  if (!hasAnyCanvasWeight(canvasGroups)) {
    // Every group is null or 0, so Canvas says nothing about weights and the syllabus read
    // behaves as it did before this ticket: it replaces the categories, and mappings that
    // survive are rewritten to the category's exact name.
    const categories =
      suggestedCategories.length > 0
        ? suggestedCategories.map((suggested) => ({
            name: suggested.name,
            weight: suggested.weight === null ? "" : String(suggested.weight),
          }))
        : current.categories;
    const exactNameBySuggestedName = new Map<string, string>();
    for (const category of categories) {
      exactNameBySuggestedName.set(nameKey(category.name), category.name);
    }
    // buildPayload compares mapping values to category names exactly, so a mapping kept by
    // case-insensitive name is rewritten to the category's exact name.
    const assignmentMappings = Object.fromEntries(
      Object.entries(current.assignmentMappings)
        .filter(([, categoryName]) => exactNameBySuggestedName.has(nameKey(categoryName)))
        .map(([assignmentId, categoryName]) => [
          assignmentId,
          exactNameBySuggestedName.get(nameKey(categoryName)) ?? "",
        ]),
    );
    return {
      categories,
      assignmentMappings,
      finalExamWeight:
        suggestedFinalExamWeight === null
          ? current.finalExamWeight
          : String(suggestedFinalExamWeight),
      canvasKept: false,
    };
  }

  // Canvas has weights, so the categories are rebuilt from the Canvas groups themselves:
  // every group, in Canvas order, no matter what the form held before. Groups sharing a
  // name (case-insensitive trimmed) merge into one category named after the first
  // occurrence, weighted by the sum of their positive weights. A syllabus category with no
  // Canvas group of the same name is not added, because Canvas's groups already hold all of
  // the course's work and adding one would double count.
  const suggestionsWeightByName = new Map<string, number | null>();
  for (const suggested of suggestedCategories) {
    suggestionsWeightByName.set(nameKey(suggested.name), suggested.weight);
  }
  const mergedGroups = new Map<
    string,
    { name: string; positives: number; hasZero: boolean; hasNull: boolean }
  >();
  for (const group of canvasGroups) {
    const weight = statedCanvasWeight(group);
    const key = nameKey(group.name);
    let entry = mergedGroups.get(key);
    if (entry === undefined) {
      entry = { name: group.name, positives: 0, hasZero: false, hasNull: false };
      mergedGroups.set(key, entry);
    }
    entry.positives += positiveCanvasWeight(group);
    if (weight === null) {
      entry.hasNull = true;
    } else if (weight === 0) {
      entry.hasZero = true;
    }
  }
  const canvasTotal = [...mergedGroups.values()].reduce((sum, entry) => sum + entry.positives, 0);
  // Canvas is complete when its (> 0) weights total 100: then its weights are authoritative
  // and the syllabus fills in nothing at all.
  const complete = Math.abs(canvasTotal - 100) <= 0.001;
  const categories = [...mergedGroups.values()].map((entry) => {
    if (entry.positives > 0) {
      return { name: entry.name, weight: String(entry.positives) };
    }
    if (complete) {
      // A complete Canvas set earns no blanks: an unweighed group shows 0 so the form stays
      // confirmable without the syllabus's help.
      return { name: entry.name, weight: "0" };
    }
    const suggestedWeight = suggestionsWeightByName.get(nameKey(entry.name));
    if (suggestedWeight !== undefined && suggestedWeight !== null) {
      return { name: entry.name, weight: String(suggestedWeight) };
    }
    // A Canvas 0 keeps showing "0" even unfilled, while a group Canvas gave no weight for
    // beats blank: the syllabus fills it or the student does.
    return { name: entry.name, weight: entry.hasZero ? "0" : "" };
  });
  // Each assignment maps to the category named after its Canvas assignment group; without a
  // usable group it keeps its current mapping while that category still exists, else it is
  // left unmapped ("") so the mapping summary flags it.
  const categoryNameByKey = new Map(
    categories.map((category) => [nameKey(category.name), category.name])
  );
  const assignmentMappings = Object.fromEntries(
    canvasAssignments.map(({ id, groupName }) => {
      const byGroup = groupName !== null ? categoryNameByKey.get(nameKey(groupName)) : undefined;
      if (byGroup !== undefined) {
        return [id, byGroup];
      }
      const currentMapping = current.assignmentMappings[id];
      if (currentMapping !== undefined && categoryNameByKey.has(nameKey(currentMapping))) {
        return [id, currentMapping];
      }
      return [id, ""];
    })
  );
  // The syllabus's final exam weight is used only when Canvas is incomplete and the
  // syllabus states one. Otherwise it is 0: a weight held outside the categories is read by
  // no grade engine, so a guessed remainder would sit in the form looking meaningful while
  // changing nothing; the running total shows the student what is still missing instead.
  const finalExamWeight =
    complete || suggestedFinalExamWeight === null ? "0" : String(suggestedFinalExamWeight);
  // "Canvas won" is about suggestions the read could not apply: one that assigns a
  // different weight to a group Canvas weighs, one dropped for having no Canvas group, or
  // — with a complete Canvas set — a positive final exam weight the field reset to 0 over.
  const groupByName = new Map(
    [...mergedGroups.values()].map((entry) => [nameKey(entry.name), entry])
  );
  const canvasKept =
    suggestedCategories.some((suggested) => {
      const entry = groupByName.get(nameKey(suggested.name));
      if (entry === undefined) {
        return true;
      }
      return (
        entry.positives > 0 &&
        suggested.weight !== null &&
        Math.abs(suggested.weight - entry.positives) > 0.001
      );
    }) || (complete && suggestedFinalExamWeight !== null && suggestedFinalExamWeight > 0);
  return { categories, assignmentMappings, finalExamWeight, canvasKept };
}

// The success message after a syllabus read: plain about the professor's Canvas weights
// winning when they did, and the ordinary invite to review otherwise.
export function syllabusReadMessage(canvasKept: boolean): string {
  return canvasKept
    ? "Your professor's Canvas weights were kept. The syllabus filled in the rest. Nothing is saved until you confirm them."
    : "The AI's suggestions are filled in below. Nothing is saved until you confirm them.";
}
