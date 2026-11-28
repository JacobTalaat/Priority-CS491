import { calculateCourseGrade, buildCategoryBreakdown } from "@/lib/grade-engine";
import { assignmentShares, type AssignmentShare } from "@/lib/grade-share";
import { readFinalExamAssignmentId, solveFinalExam, type FinalExamResult } from "@/lib/final-exam-solver";
import { letterForGrade } from "@/lib/letter-grade";
import { parseSavedSetup, withFinalExamCategory, type SavedGradeSetupRow } from "@/lib/grade-setup";
import type { CategoryBreakdown } from "@/lib/grade-engine";
import type { WeightedGradeResult } from "@/lib/weighted-grade";
import type { GradeAssignment } from "@/lib/weighted-grade";

export type CourseGradeData = {
  setupConfirmed: boolean;
  engine: "weighted" | "points";
  letter: string | null;
  grade: WeightedGradeResult;
  breakdown: CategoryBreakdown[];
  finalExam: FinalExamResult;
  shares: AssignmentShare[];
};

export function calculateCourseGradeData(
  gradeSetup: SavedGradeSetupRow,
  assignments: readonly GradeAssignment[],
): CourseGradeData {
  const savedSetup = parseSavedSetup(gradeSetup);
  const setup = savedSetup ? withFinalExamCategory(savedSetup) : null;
  const { choice, grade } = calculateCourseGrade(setup, assignments);
  const breakdown =
    choice.engine === "weighted" && grade.status !== "unsupported"
      ? buildCategoryBreakdown(choice.setup, assignments)
      : [];
  const finalExam = solveFinalExam({
    choice,
    assignments,
    finalAssignmentId: readFinalExamAssignmentId(setup),
    cutoffs: setup?.cutoffs ?? {},
    finalExamWeight: setup?.finalExamWeight ?? 0,
    unsupportedRules: setup?.unsupportedRules ?? [],
  });

  return {
    setupConfirmed: gradeSetup !== null,
    engine: choice.engine,
    letter: letterForGrade(grade, setup?.cutoffs ?? {}),
    grade,
    breakdown,
    finalExam,
    shares: assignmentShares(setup, assignments),
  };
}
