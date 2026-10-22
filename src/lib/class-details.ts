// Class details are saved in the grade setup's `classDetails` as plain strings, under the keys
// GET /api/courses/[courseId] reads: officeHours, latePolicy, and contacts.

export type DetailContact = { name: string | null; role: string | null; email: string | null };

// The AI's contact list as one editable string, e.g.
// "Dr. Ruiz (Instructor) eruiz@njit.edu; Sam Lee (TA) slee@njit.edu".
export function formatContacts(contacts: readonly DetailContact[]): string {
  return contacts
    .map((contact) => {
      const name = contact.name?.trim() ?? "";
      const role = contact.role?.trim() ?? "";
      const email = contact.email?.trim() ?? "";
      return [name, role ? `(${role})` : "", email].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join("; ");
}

// Reads a saved text detail, treating anything that isn't a string as empty.
export function detailText(details: Record<string, unknown>, key: string): string {
  const value = details[key];
  return typeof value === "string" ? value : "";
}

// Blank fields are saved as null, which the course details route also returns as null.
export function detailValue(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}
