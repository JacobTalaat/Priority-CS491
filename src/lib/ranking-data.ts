import { prisma } from "@/lib/prisma";
import { assignmentShares } from "@/lib/grade-share";
import { parseSavedSetup, type GradeSetupPayload } from "@/lib/grade-setup";
import { chooseGradeEngine } from "@/lib/grade-engine";
import { BOUNDARY_TOLERANCE, letterBoundary, type LetterBoundary } from "@/lib/letter-boundary";
import { calculatePointsGrade } from "@/lib/points-grade";
import { calculateWeightedGrade } from "@/lib/weighted-grade";
import { rankOpenWork, type OpenWorkItem, type RankedItem } from "@/lib/ranking";

// Hours are not stored yet; PR-124 makes a plan's total the hours.

const openWorkCourseSelect = {
  id: true,
  name: true,
  gradeSetup: {
    select: {
      categories: true,
      assignmentMappings: true,
      finalExamWeight: true,
      cutoffs: true,
      classDetails: true,
    },
  },
  assignments: {
    select: {
      id: true,
      title: true,
      dueAt: true,
      hasDueDate: true,
      pointsPossible: true,
      grade: { select: { score: true, submittedAt: true, excused: true } },
    },
  },
} as const;

export async function loadOpenWork(userId: string, now: Date): Promise<RankedItem[]> {
  const courses = await prisma.course.findMany({
    where: { userId, isCurrent: true },
    select: openWorkCourseSelect,
  });

  const items: OpenWorkItem[] = [];
  const boundariesByAssignmentId = new Map<string, LetterBoundary | null>();
  for (const course of courses) {
    const setup = parseSavedSetup(course.gradeSetup);
    const assignments = course.assignments.map((assignment) => ({
      id: assignment.id,
      pointsPossible: assignment.pointsPossible,
      grade: assignment.grade,
    }));
    const shares = new Map(
      assignmentShares(setup, assignments).map((entry) => [entry.assignmentId, entry.share]),
    );
    collectBoundaries(setup, assignments, shares, boundariesByAssignmentId);

    for (const assignment of course.assignments) {
      const score = assignment.grade?.score;
      const graded = typeof score === "number" && Number.isFinite(score);
      // A graded assignment is done, but so is one the student already handed
      // in and is waiting on, or one the teacher excused: none of those is
      // something the student can act on.
      const handedIn = Boolean(assignment.grade?.submittedAt);
      const excused = assignment.grade?.excused === true;
      if (graded || handedIn || excused) {
        continue;
      }
      items.push({
        assignmentId: assignment.id,
        courseId: course.id,
        courseName: course.name,
        title: assignment.title,
        dueAt: assignment.hasDueDate && assignment.dueAt ? assignment.dueAt : null,
        share: shares.get(assignment.id) ?? null,
        hours: null,
        graded,
      });
    }
  }

  // The flag is merged after ranking: it describes risk, not urgency, so it
  // must not be able to bend the order or the score.
  const ranked = rankOpenWork(items, now);
  return ranked.map((entry) => ({
    ...entry,
    boundary:
      entry.share !== null && Number.isFinite(entry.share) && entry.share > 0
        ? (boundariesByAssignmentId.get(entry.assignmentId) ?? null)
        : null,
  }));
}

// An item can only carry a letter flag when the course's grade is a real
// "calculated" number from the same engine choice the grade route makes, and
// when the setup has nothing that would make the percentage provisional.
// A final exam weight held outside the categories means a chunk of the grade is
// still ungraded, so no cutoff flag can be trusted yet; a setup without cutoffs
// gives letterBoundary nothing to work with either way.
function collectBoundaries(
  setup: GradeSetupPayload | null,
  assignments: readonly { id: string; pointsPossible: number; grade: { score: number | null } | null }[],
  sharesById: Map<string, number | null>,
  out: Map<string, LetterBoundary | null>,
): void {
  const choice = chooseGradeEngine(setup);
  const gradeOf = (rows: typeof assignments) =>
    choice.engine === "weighted" ? calculateWeightedGrade(choice.setup, rows) : calculatePointsGrade(rows);
  const grade = gradeOf(assignments);
  if (grade.status !== "calculated" || !setup || setup.finalExamWeight > 0 || !setup.cutoffs) {
    return;
  }
  // What the grade would be if this one item were scored, asked of the same engine:
  // the course being near a cutoff does not mean this item can carry it across.
  const gradeIfScored = (assignmentId: string, score: (pointsPossible: number) => number): number | null => {
    const rows = assignments.map((row) =>
      row.id === assignmentId ? { ...row, grade: { score: score(row.pointsPossible) } } : row,
    );
    const result = gradeOf(rows);
    return result.status === "calculated" ? result.percentage : null;
  };
  for (const [assignmentId, share] of sharesById) {
    if (typeof share !== "number" || !Number.isFinite(share) || share <= 0) {
      continue;
    }
    const boundary = letterBoundary(grade.percentage, setup.cutoffs);
    if (!boundary) {
      continue;
    }
    // Flag only what is true of this item: at-risk if a zero on it would fall below
    // the cutoff, within-reach if full marks on it would reach the next one.
    const outcome =
      boundary.direction === "at-risk"
        ? gradeIfScored(assignmentId, () => 0)
        : gradeIfScored(assignmentId, (pointsPossible) => pointsPossible);
    const crosses =
      outcome !== null &&
      (boundary.direction === "at-risk"
        ? outcome < boundary.cutoff - BOUNDARY_TOLERANCE
        : outcome >= boundary.cutoff - BOUNDARY_TOLERANCE);
    if (crosses) {
      out.set(assignmentId, boundary);
    }
  }
}
