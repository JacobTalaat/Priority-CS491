import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseGradeSetup, type GradeSetupPayload } from "@/lib/grade-setup";
import { type WeightedGradeResult } from "@/lib/weighted-grade";
import { buildCategoryBreakdown, calculateCourseGrade, type CategoryBreakdown } from "@/lib/grade-engine";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };

type GradeResponse = {
  course: {
    id: string;
    name: string;
    courseCode: string | null;
    term: string | null;
  };
  setupConfirmed: boolean;
  engine: "weighted" | "points";
  grade: WeightedGradeResult;
  breakdown: CategoryBreakdown[];
};

// A saved row is a confirmed setup: the confirm step is what writes it.
// The stored JSON is re-validated here because the database could hold
// anything; an invalid setup grades as if there were none.
function parseSavedSetup(
  row:
    | {
        categories: unknown;
        assignmentMappings: unknown;
        finalExamWeight: unknown;
        cutoffs: unknown;
        classDetails: unknown;
        unsupportedRules: unknown;
      }
    | null,
): GradeSetupPayload | null {
  if (!row) {
    return null;
  }
  const parsed = parseGradeSetup(row);
  // A row saved before unsupported rules existed has none on record.
  return parsed.ok ? { ...parsed.data, unsupportedRules: parsed.data.unsupportedRules ?? [] } : null;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse<GradeResponse | { error: string }>> {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const { courseId } = await context.params;
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: user.id, isCurrent: true },
    select: {
      id: true,
      name: true,
      courseCode: true,
      term: true,
      gradeSetup: {
        select: {
          categories: true,
          assignmentMappings: true,
          finalExamWeight: true,
          cutoffs: true,
          classDetails: true,
          unsupportedRules: true,
          confirmedAt: true,
        },
      },
      assignments: {
        select: {
          id: true,
          pointsPossible: true,
          grade: { select: { score: true } },
        },
        orderBy: [{ title: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!course) {
    return NextResponse.json({ error: "Current course not found." }, { status: 404 });
  }

  const setup = parseSavedSetup(course.gradeSetup);
  const assignments = course.assignments.map((assignment) => ({
    id: assignment.id,
    pointsPossible: assignment.pointsPossible,
    grade: assignment.grade,
  }));

  const { choice, grade } = calculateCourseGrade(setup, assignments);
  // Only an unsupported grade has nothing to break down: the engine gave up
  // on the course as a whole, so per-category figures would be misleading.
  const breakdown =
    choice.engine === "weighted" && grade.status !== "unsupported"
      ? buildCategoryBreakdown(choice.setup, assignments)
      : [];

  return NextResponse.json({
    course: {
      id: course.id,
      name: course.name,
      courseCode: course.courseCode,
      term: course.term,
    },
    setupConfirmed: course.gradeSetup !== null,
    engine: choice.engine,
    grade,
    breakdown,
  });
}
