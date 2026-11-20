import { buildCanvasSetup } from "@/lib/canvas-auto-setup";
import { parseSavedSetup, type GradeSetupPayload } from "@/lib/grade-setup";
import { prisma } from "@/lib/prisma";
import type { CourseGradeSetup } from "@/generated/prisma/client";

function mappingsDiffer(
  saved: GradeSetupPayload,
  built: GradeSetupPayload
): boolean {
  const savedByKey = new Map(
    saved.assignmentMappings.map((mapping) => [mapping.assignmentId, mapping.category])
  );
  const builtByKey = new Map(
    built.assignmentMappings.map((mapping) => [mapping.assignmentId, mapping.category])
  );
  if (savedByKey.size !== builtByKey.size) {
    return true;
  }
  for (const [assignmentId, category] of builtByKey) {
    if (savedByKey.get(assignmentId) !== category) {
      return true;
    }
  }
  return false;
}

// The student confirm route can save its own row between the read above and
// the writes below, so every write is scoped to source "canvas" and a create
// that loses the race yields to the student's row instead of failing the sync.
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// Canvas already stated a complete weighted setup, so sync confirms it for the
// student. A setup the student confirmed by hand (source "student") is never
// touched; sync owns rows it wrote itself (source "canvas").
export async function applyCanvasSetup(courseId: string): Promise<void> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      applyGroupWeights: true,
      assignmentGroups: {
        select: { name: true, groupWeight: true, hasDropRules: true },
        orderBy: [{ position: "asc" }, { name: "asc" }],
      },
      assignments: {
        select: { id: true, assignmentGroup: { select: { name: true } } },
        orderBy: [{ title: "asc" }, { id: "asc" }],
      },
      gradeSetup: true,
    },
  });
  if (!course) {
    return;
  }
  const built = buildCanvasSetup({
    applyGroupWeights: course.applyGroupWeights,
    groups: course.assignmentGroups,
    assignments: course.assignments.map((assignment) => ({
      id: assignment.id,
      groupName: assignment.assignmentGroup?.name ?? null,
    })),
  });
  const existing = course.gradeSetup;
  if (existing?.source === "student") {
    return;
  }
  if (built === null) {
    if (existing) {
      await prisma.courseGradeSetup.deleteMany({ where: { courseId, source: "canvas" } });
    }
    return;
  }
  if (!existing) {
    try {
      await prisma.courseGradeSetup.create({
        data: { courseId, ...built, source: "canvas", confirmedAt: new Date() },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
    return;
  }
  // Cutoffs, class details, and unsupported rules stay whatever a previous
  // build saved; only what Canvas states changes here.
  const saved = parseSavedSetup(existing as CourseGradeSetup);
  if (
    saved === null ||
    saved.finalExamWeight !== built.finalExamWeight ||
    JSON.stringify(saved.categories) !== JSON.stringify(built.categories) ||
    mappingsDiffer(saved, built)
  ) {
    await prisma.courseGradeSetup.updateMany({
      where: { courseId, source: "canvas" },
      data: {
        categories: built.categories,
        assignmentMappings: built.assignmentMappings,
        finalExamWeight: built.finalExamWeight,
        confirmedAt: new Date(),
      },
    });
  }
}
