import { fetchAllPages } from "@/lib/canvas-pagination";
import { prisma } from "@/lib/prisma";
import type { Course } from "@/generated/prisma/client";

type CanvasAssignmentGroup = {
  id?: unknown;
  name?: unknown;
  group_weight?: unknown;
  position?: unknown;
};

export async function importAssignmentGroups(
  credentials: { baseUrl: string; token: string },
  course: Course
): Promise<{ imported: number }> {
  const groups = await fetchAllPages<CanvasAssignmentGroup>(
    credentials.baseUrl,
    credentials.token,
    `/api/v1/courses/${course.canvasId}/assignment_groups?per_page=100`
  );
  let imported = 0;
  for (const group of groups) {
    if (group?.id === undefined || group.id === null || typeof group.name !== "string") {
      continue;
    }
    const canvasId = String(group.id);
    const data = {
      name: group.name,
      groupWeight: typeof group.group_weight === "number" ? group.group_weight : null,
      position: typeof group.position === "number" ? group.position : null,
    };
    await prisma.assignmentGroup.upsert({
      where: { courseId_canvasId: { courseId: course.id, canvasId } },
      create: { courseId: course.id, canvasId, ...data },
      update: { ...data },
    });
    imported += 1;
  }
  return { imported };
}
