import { fetchAllPages } from "@/lib/canvas-pagination";
import { prisma } from "@/lib/prisma";
import type { Course } from "@/generated/prisma/client";

type CanvasAssignmentGroup = {
  id?: unknown;
  name?: unknown;
  group_weight?: unknown;
  position?: unknown;
};

// Courses rarely have more than a handful of groups, so a lower bar than assignments.
const EMPTY_GROUP_LISTING_DELETE_GUARD = 5;

export async function importAssignmentGroups(
  credentials: { baseUrl: string; token: string },
  course: Course
): Promise<{ imported: number; removed: number }> {
  // fetchAllPages throws on any failed page before returning, so a part-way
  // failure never reaches the removal at the bottom: nothing is deleted.
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
  const returnedCanvasIds = new Set<string>();
  for (const group of groups) {
    if (group?.id === undefined || group.id === null) {
      continue;
    }
    returnedCanvasIds.add(String(group.id));
  }
  // groups Canvas dropped are removed once the full listing is in hand; an
  // assignment still pointing at one is detached through the
  // onDelete: SetNull on Assignment.assignmentGroupId
  const removalFilter = {
    courseId: course.id,
    ...(returnedCanvasIds.size > 0 ? { canvasId: { notIn: [...returnedCanvasIds] } } : {}),
  };
  if (returnedCanvasIds.size === 0) {
    // As with assignments, an empty listing for a course that has many groups is far
    // more likely a Canvas or permission glitch than a professor deleting them all.
    const stored = await prisma.assignmentGroup.count({ where: { courseId: course.id } });
    if (stored >= EMPTY_GROUP_LISTING_DELETE_GUARD) {
      console.error("Canvas returned an empty assignment group list; skipping group removal for this sync");
      return { imported, removed: 0 };
    }
  }
  const result = await prisma.assignmentGroup.deleteMany({ where: removalFilter });
  return { imported, removed: result.count };
}
