import { prisma } from "@/lib/prisma";
import { assignmentShares } from "@/lib/grade-share";
import { parseSavedSetup } from "@/lib/grade-setup";
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

  return rankOpenWork(items, now);
}
