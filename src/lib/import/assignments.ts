import { fetchAllPages } from "@/lib/canvas-pagination";
import { prisma } from "@/lib/prisma";
import type { Course } from "@/generated/prisma/client";

type CanvasAssignment = {
  id?: unknown;
  name?: unknown;
  due_at?: unknown;
  points_possible?: unknown;
  assignment_group_id?: unknown;
  html_url?: unknown;
};

export async function importAssignments(
  credentials: { baseUrl: string; token: string },
  course: Course
): Promise<{ imported: number; skipped: number }> {
  const assignments = await fetchAllPages<CanvasAssignment>(
    credentials.baseUrl,
    credentials.token,
    `/api/v1/courses/${course.canvasId}/assignments?per_page=100`
  );
  const storedGroups = await prisma.assignmentGroup.findMany({
    where: { courseId: course.id },
    select: { id: true, canvasId: true },
  });
  const groupIdByCanvasId = new Map<string, string>();
  for (const group of storedGroups) {
    groupIdByCanvasId.set(group.canvasId, group.id);
  }
  let imported = 0;
  let skipped = 0;
  for (const assignment of assignments) {
    if (assignment?.id === undefined || assignment.id === null || typeof assignment.name !== "string") {
      skipped += 1;
      continue;
    }
    if (typeof assignment.points_possible !== "number" || assignment.points_possible === 0) {
      skipped += 1;
      continue;
    }
    const localGroupId =
      assignment.assignment_group_id === undefined || assignment.assignment_group_id === null
        ? undefined
        : groupIdByCanvasId.get(String(assignment.assignment_group_id));
    const canvasId = String(assignment.id);
    let dueAt: Date | null = null;
    if (typeof assignment.due_at === "string") {
      const ms = Date.parse(assignment.due_at);
      dueAt = Number.isNaN(ms) ? null : new Date(ms);
    }
    const data = {
      title: assignment.name,
      dueAt,
      hasDueDate: dueAt !== null,
      pointsPossible: assignment.points_possible,
      htmlUrl: typeof assignment.html_url === "string" ? assignment.html_url : null,
      assignmentGroupId: localGroupId ?? null,
    };
    await prisma.assignment.upsert({
      where: { courseId_canvasId: { courseId: course.id, canvasId } },
      create: { courseId: course.id, canvasId, ...data },
      update: { ...data },
    });
    imported += 1;
  }
  return { imported, skipped };
}
