export type GradeSetupCategory = {
  name: string;
  weight: number;
};

export type GradeSetupAssignmentMapping = {
  assignmentId: string;
  category: string;
};

export type GradeSetupPayload = {
  categories: GradeSetupCategory[];
  assignmentMappings: GradeSetupAssignmentMapping[];
  finalExamWeight: number;
  cutoffs: Record<string, number>;
  classDetails: Record<string, string | number | null>;
};

export type GradeSetupParseResult =
  | { ok: true; data: GradeSetupPayload }
  | { ok: false; error: string };

// The grade engines only read weights through categories, yet a setup may park the
// final exam's weight in finalExamWeight with the final assignment mapped into another
// category. Folding that weight into a category here lets such a saved setup grade
// as the syllabus stated, while the setup stays stored exactly as confirmed.
export function withFinalExamCategory(setup: GradeSetupPayload): GradeSetupPayload {
  const finalExamAssignmentId = setup.classDetails.finalExamAssignmentId;
  if (
    setup.finalExamWeight <= 0 ||
    typeof finalExamAssignmentId !== "string" ||
    finalExamAssignmentId.length === 0 ||
    !setup.assignmentMappings.some((mapping) => mapping.assignmentId === finalExamAssignmentId)
  ) {
    return setup;
  }

  // Copy everything so the saved setup never changes under us.
  const categories = setup.categories.map((category) => ({ ...category }));
  // An existing "Final exam" / "Final" category takes the weight only when nothing but
  // the picked final is graded in it. A name is not enough: a "Final" category can hold a
  // final project, and pooling that with the exam would weight both by their combined share.
  const existingFinal = categories.find((category) => {
    const normalizedName = category.name.trim().toLowerCase();
    if (normalizedName !== "final exam" && normalizedName !== "final") {
      return false;
    }
    return setup.assignmentMappings.every(
      (mapping) => mapping.category !== category.name || mapping.assignmentId === finalExamAssignmentId,
    );
  });
  let finalCategoryName: string;
  if (existingFinal) {
    existingFinal.weight += setup.finalExamWeight;
    finalCategoryName = existingFinal.name;
  } else {
    // Category names must stay unique, so a taken name gets a plain suffix.
    const taken = new Set(categories.map((category) => category.name.trim().toLowerCase()));
    finalCategoryName = taken.has("final exam") ? "Final exam (picked)" : "Final exam";
    categories.push({ name: finalCategoryName, weight: setup.finalExamWeight });
  }

  const assignmentMappings = setup.assignmentMappings.filter(
    (mapping) => mapping.assignmentId !== finalExamAssignmentId,
  );
  assignmentMappings.push({ assignmentId: finalExamAssignmentId, category: finalCategoryName });

  return {
    ...setup,
    categories,
    assignmentMappings,
    // The weight now lives in a category; totals still sum to 100.
    finalExamWeight: 0,
  };
}

// A saved row is a confirmed setup: the confirm step is what writes it.
// The stored JSON is re-validated because the database could hold anything;
// an invalid setup is treated as no setup.
export type SavedGradeSetupRow =
  | {
      categories: unknown;
      assignmentMappings: unknown;
      finalExamWeight: unknown;
      cutoffs: unknown;
      classDetails: unknown;
    }
  | null;

export function parseSavedSetup(row: SavedGradeSetupRow): GradeSetupPayload | null {
  if (!row) {
    return null;
  }
  const parsed = parseGradeSetup(row);
  return parsed.ok ? parsed.data : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function parseGradeSetup(value: unknown): GradeSetupParseResult {
  if (!isRecord(value)) {
    return { ok: false, error: "The setup must be a JSON object." };
  }
  if (!Array.isArray(value.categories) || value.categories.length === 0) {
    return { ok: false, error: "Add at least one weight category." };
  }

  const categories: GradeSetupCategory[] = [];
  const categoryNameByNormalizedName = new Map<string, string>();
  for (const category of value.categories) {
    if (
      !isRecord(category) ||
      typeof category.name !== "string" ||
      category.name.trim().length === 0 ||
      !isPercentage(category.weight)
    ) {
      return { ok: false, error: "Each category needs a name and a weight from 0 to 100." };
    }
    const name = category.name.trim();
    const normalizedName = name.toLowerCase();
    if (categoryNameByNormalizedName.has(normalizedName)) {
      return { ok: false, error: "Category names must be unique." };
    }
    categoryNameByNormalizedName.set(normalizedName, name);
    categories.push({ name, weight: category.weight });
  }

  if (!isPercentage(value.finalExamWeight)) {
    return { ok: false, error: "The final exam weight must be from 0 to 100." };
  }
  const totalWeight = categories.reduce((total, category) => total + category.weight, value.finalExamWeight);
  if (Math.abs(totalWeight - 100) > 0.001) {
    return { ok: false, error: "Category weights and the final exam weight must add up to 100." };
  }

  if (!Array.isArray(value.assignmentMappings)) {
    return { ok: false, error: "Assignment mappings must be a list." };
  }
  const assignmentMappings: GradeSetupAssignmentMapping[] = [];
  const mappedAssignmentIds = new Set<string>();
  for (const mapping of value.assignmentMappings) {
    if (!isRecord(mapping)) {
      return { ok: false, error: "Each assignment must map to an existing category." };
    }
    const assignmentId = mapping.assignmentId;
    const categoryName = mapping.category;
    if (typeof assignmentId !== "string" || assignmentId.length === 0 || typeof categoryName !== "string") {
      return { ok: false, error: "Each assignment must map to an existing category." };
    }
    const canonicalCategory = categoryNameByNormalizedName.get(categoryName.trim().toLowerCase());
    if (!canonicalCategory) {
      return { ok: false, error: "Each assignment must map to an existing category." };
    }
    if (mappedAssignmentIds.has(assignmentId)) {
      return { ok: false, error: "An assignment cannot be mapped more than once." };
    }
    mappedAssignmentIds.add(assignmentId);
    assignmentMappings.push({
      assignmentId,
      category: canonicalCategory,
    });
  }

  if (!isRecord(value.cutoffs)) {
    return { ok: false, error: "Grade cutoffs must be an object of grade labels and percentages." };
  }
  const cutoffs: Record<string, number> = {};
  for (const [label, percentage] of Object.entries(value.cutoffs)) {
    if (!label.trim() || !isPercentage(percentage)) {
      return { ok: false, error: "Each grade cutoff needs a label and a percentage from 0 to 100." };
    }
    cutoffs[label.trim()] = percentage;
  }

  if (!isRecord(value.classDetails)) {
    return { ok: false, error: "Class details must be an object." };
  }
  const classDetails: Record<string, string | number | null> = {};
  for (const [label, detail] of Object.entries(value.classDetails)) {
    if (
      !label.trim() ||
      (detail !== null &&
        typeof detail !== "string" &&
        (typeof detail !== "number" || !Number.isFinite(detail)))
    ) {
      return { ok: false, error: "Class details must contain text, numbers, or null values." };
    }
    classDetails[label.trim()] = detail;
  }

  return {
    ok: true,
    data: { categories, assignmentMappings, finalExamWeight: value.finalExamWeight, cutoffs, classDetails },
  };
}
