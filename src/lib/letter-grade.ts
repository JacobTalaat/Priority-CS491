import type { WeightedGradeResult } from "./weighted-grade";

// Grades are floating-point sums, so a comparison to the exact boundary value
// allows the same drift the rest of the grade math does.
const CUTOFF_TOLERANCE = 1e-9;

// The letter a calculated grade earns: the label of the highest saved cutoff the
// percentage reaches. An exact cutoff counts as reached. When every cutoff sits
// above the grade, the lowest label only applies if its own cutoff is 0, so a
// scale without an F-at-0 leaves the letter as null. Cutoffs may be stored in any
// order and are sorted here, and non-numeric or non-finite values are ignored.
export function letterGrade(percentage: number, cutoffs: Record<string, number>): string | null {
  if (!Number.isFinite(percentage)) {
    return null;
  }
  const entries = Object.entries(cutoffs).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  if (entries.length === 0) {
    return null;
  }
  // Equal cutoffs under different labels resolve by label, so the answer never
  // depends on the order the setup happened to store them in.
  entries.sort(([labelA, a], [labelB, b]) => b - a || (labelA < labelB ? -1 : labelA > labelB ? 1 : 0));
  const reached = entries.find(([, cutoff]) => cutoff <= percentage + CUTOFF_TOLERANCE);
  return reached ? reached[0] : null;
}

// Convenience wrapper for a whole grade response: only a calculated grade has a
// letter; insufficient-data and unsupported never do.
export function letterForGrade(grade: WeightedGradeResult, cutoffs: Record<string, number>): string | null {
  return grade.status === "calculated" ? letterGrade(grade.percentage, cutoffs) : null;
}
