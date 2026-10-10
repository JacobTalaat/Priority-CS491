import { fetchAllPages } from "@/lib/canvas-pagination";
import { prisma } from "@/lib/prisma";
import type { Course } from "@/generated/prisma/client";

type CanvasSubmission = {
  assignment_id?: unknown;
  score?: unknown;
  workflow_state?: unknown;
  graded_at?: unknown;
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
    if (submission?.excused === true) {
      skipped += 1;
      continue;
    }
    if (submission?.workflow_state !== "graded" || typeof submission?.score !== "number") {
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
      score: submission.score,
      gradedAt: parseDate(submission.graded_at),
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
