import { fetchAllPages } from "@/lib/canvas-pagination";
import { htmlToText } from "@/lib/html-to-text";
import { prisma } from "@/lib/prisma";
import type { Course } from "@/generated/prisma/client";

// An empty Canvas listing combined with this many stored assignments reads as a
// Canvas or permission glitch rather than a professor deleting everything, so
// removal is skipped for that sync.
const EMPTY_LISTING_DELETE_GUARD = 20;

type CanvasAssignment = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  due_at?: unknown;
  points_possible?: unknown;
  assignment_group_id?: unknown;
  html_url?: unknown;
};

export async function importAssignments(
  credentials: { baseUrl: string; token: string },
  course: Course
): Promise<{ imported: number; skipped: number; removed: number }> {
  // fetchAllPages throws on any failed page before returning, so a part-way
  // failure never reaches the removal at the bottom: nothing is deleted.
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
      // Canvas descriptions are HTML; the AI planner reads plain text. The API import is
      // the authority for it, so a re-import with no description clears a stale one.
      description: htmlToText(assignment.description),
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
  // the returned set is what Canvas holds now, including rows we skipped above
  // for a missing name or zero points, so those are never treated as removed
  const returnedCanvasIds = new Set<string>();
  for (const assignment of assignments) {
    if (assignment?.id === undefined || assignment.id === null) {
      continue;
    }
    returnedCanvasIds.add(String(assignment.id));
  }
  // The calendar-feed import writes the same Canvas assignment ids into the same
  // rows, and only students with a Canvas token reach this import, so an
  // assignment missing from a complete listing is gone from Canvas whichever
  // import first created its row.
  const removalFilter = {
    courseId: course.id,
    ...(returnedCanvasIds.size > 0 ? { canvasId: { notIn: [...returnedCanvasIds] } } : {}),
  };
  let removed = 0;
  if (returnedCanvasIds.size === 0) {
    // an empty listing is a valid "the course has no assignments" answer, but
    // it is also the riskiest case here: one glitched response would wipe a
    // whole course. Past the guard, sit the sync out and say why.
    const apiCount = await prisma.assignment.count({ where: { courseId: course.id } });
    if (apiCount >= EMPTY_LISTING_DELETE_GUARD) {
      console.error("Canvas returned an empty assignment list; skipping assignment removal for this sync");
    } else {
      const result = await prisma.assignment.deleteMany({ where: removalFilter });
      removed = result.count;
    }
  } else {
    const result = await prisma.assignment.deleteMany({ where: removalFilter });
    removed = result.count;
  }
  // grades of removed assignments are gone too, through Grade's
  // onDelete: Cascade on assignmentId
  return { imported, skipped, removed };
}
