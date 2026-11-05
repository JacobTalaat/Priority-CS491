// How close a course's current grade has to sit to a letter cutoff for the
// "Could drop you below an A-" flag to show up. Inclusive at exactly 2.00:
// a two-point final exam is a single question, so it counts as close.
export const BOUNDARY_POINTS = 2;

// Grades are floating-point sums: 64.01 - 62.01 is 2.000000000000007, which must
// still count as "exactly 2". Comparisons allow this much drift.
export const BOUNDARY_TOLERANCE = 1e-9;

export type LetterBoundary = {
  letter: string;
  cutoff: number;
  direction: "at-risk" | "within-reach";
  distance: number;
};

export function letterBoundary(
  gradePercentage: number,
  cutoffs: Record<string, number>,
): LetterBoundary | null {
  if (!Number.isFinite(gradePercentage)) {
    return null;
  }

  // Cutoffs can come from stored JSON, so unusable values are skipped rather
  // than trusted to have made it through validation.
  const entries = Object.entries(cutoffs).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  if (entries.length === 0) {
    return null;
  }
  // Equal cutoffs under different labels resolve by label, so the answer never
  // depends on the order the setup happened to store them in.
  entries.sort(([labelA, a], [labelB, b]) => a - b || (labelA < labelB ? -1 : labelA > labelB ? 1 : 0));

  // Falling below the bottom of the scale (the lowest letter, usually F at 0)
  // is not something the student could lose by pushing, so a cutoff at 0 or
  // below never makes a flag. A higher cutoff still flags even when it is the
  // lowest usable one: dropping below "A- at 90" is exactly what the flag means.
  const entriesForRisk = entries.filter(([, cutoff]) => cutoff > 0);

  // The letter the student currently holds is the highest cutoff they meet.
  let held: { letter: string; cutoff: number } | null = null;
  for (const [letter, cutoff] of entriesForRisk) {
    if (gradePercentage >= cutoff - BOUNDARY_TOLERANCE && (!held || cutoff > held.cutoff)) {
      held = { letter, cutoff };
    }
  }

  // Within-reach: the next cutoff above the grade, whenever it is close.
  let next: { letter: string; cutoff: number } | null = null;
  for (const [letter, cutoff] of entries) {
    if (cutoff > gradePercentage + BOUNDARY_TOLERANCE && (!next || cutoff < next.cutoff)) {
      next = { letter, cutoff };
    }
  }

  // When both apply the cutoffs are closer than 4 points apart, and losing the
  // letter already held matters more than gaining the one above it, so
  // at-risk wins over within-reach.
  if (held && gradePercentage - held.cutoff <= BOUNDARY_POINTS + BOUNDARY_TOLERANCE) {
    return { ...held, direction: "at-risk", distance: gradePercentage - held.cutoff };
  }
  if (next && next.cutoff - gradePercentage <= BOUNDARY_POINTS + BOUNDARY_TOLERANCE) {
    return { ...next, direction: "within-reach", distance: next.cutoff - gradePercentage };
  }
  return null;
}
