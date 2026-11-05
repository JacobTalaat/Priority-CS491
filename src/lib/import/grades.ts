import { fetchAllPages } from "@/lib/canvas-pagination";
import { prisma } from "@/lib/prisma";
import type { Course } from "@/generated/prisma/client";

type CanvasSubmission = {
  assignment_id?: unknown;
  score?: unknown;
  workflow_state?: unknown;
  graded_at?: unknown;
  submitted_at?: unknown;
  excused?: unknown;
};

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export async function importGrades(
  credentials: { baseUrl: string; token: string },
  course: Course
): Promise<{ imported: number; skipped: number }> {
  const submissions = await fetchAllPages<CanvasSubmission>(
    credentials.baseUrl,
    credentials.token,
    `/api/v1/courses/${course.canvasId}/students/submissions?student_ids[]=self&per_page=100`
  );
  const storedAssignments = await prisma.assignment.findMany({
    where: { courseId: course.id },
    select: { id: true, canvasId: true },
  });
  const assignmentIdByCanvasId = new Map<string, string>();
  for (const assignment of storedAssignments) {
    assignmentIdByCanvasId.set(assignment.canvasId, assignment.id);
  }
  let imported = 0;
  let skipped = 0;
  for (const submission of submissions) {
    const excused = submission?.excused === true;
    const score = typeof submission?.score === "number" ? submission.score : null;
    const submittedAt = parseDate(submission?.submitted_at);
    // An excused submission claiming a score is contradictory payload: the
    // old rule skips it and stays skipped.
    if (excused && score !== null) {
      skipped += 1;
      continue;
    }
    if (score !== null && submission?.workflow_state !== "graded") {
      skipped += 1;
      continue;
    }
    // A submission the student handed in, or one Canvas excused, is a fact
    // worth storing even before a grade lands, so the open-work list can
    // leave it out instead of ranking work that is already waiting on a
    // teacher.
    if (!excused && score === null && submittedAt === null) {
      skipped += 1;
      continue;
    }
    const localAssignmentId =
      submission?.assignment_id === undefined || submission.assignment_id === null
        ? undefined
        : assignmentIdByCanvasId.get(String(submission.assignment_id));
    if (localAssignmentId === undefined) {
      skipped += 1;
      continue;
    }
    const data = {
      score,
      gradedAt: score === null ? null : parseDate(submission.graded_at),
      submittedAt,
      excused,
    };
    await prisma.grade.upsert({
      where: { assignmentId: localAssignmentId },
      create: { assignmentId: localAssignmentId, ...data },
      update: { ...data },
    });
    imported += 1;
  }
  return { imported, skipped };
}
