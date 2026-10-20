// Helpers for the "Assignment categories" part of the Weights form, where each assignment
// is mapped to a category by name.

// An assignment counts as unmapped when it has no category or its category no longer exists
// (for example after the category was renamed to blank or removed).
export function unmappedAssignmentIds(
  assignments: { id: string }[],
  mappings: Record<string, string | undefined>,
  categoryNames: string[],
): string[] {
  const names = new Set(categoryNames.map((name) => name.trim()).filter(Boolean));
  return assignments
    .filter((assignment) => {
      const category = mappings[assignment.id]?.trim();
      return !category || !names.has(category);
    })
    .map((assignment) => assignment.id);
}

export function mappingSummary(total: number, unmapped: number): string {
  if (unmapped === 0) {
    return `All ${total} assignment${total === 1 ? " has" : "s have"} a category.`;
  }
  return `${unmapped} of ${total} assignment${total === 1 ? "" : "s"} still need${unmapped === 1 ? "s" : ""} a category.`;
}
