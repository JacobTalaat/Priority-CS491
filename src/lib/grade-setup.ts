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
