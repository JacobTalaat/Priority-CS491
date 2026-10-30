import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseSavedSetup, withFinalExamCategory } from "@/lib/grade-setup";
import { calculatePointsGrade } from "@/lib/points-grade";
import { calculateWeightedGrade, type WeightedGradeResult } from "@/lib/weighted-grade";
import { buildCategoryBreakdown, chooseGradeEngine, type CategoryBreakdown } from "@/lib/grade-engine";
import { readFinalExamAssignmentId, solveFinalExam, type FinalExamResult } from "@/lib/final-exam-solver";
import { assignmentShares, type AssignmentShare } from "@/lib/grade-share";

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
  finalExam: FinalExamResult;
  shares: AssignmentShare[];
};

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

  const savedSetup = parseSavedSetup(course.gradeSetup);
  // Normalize before choosing the engine so a final exam weight parked outside the
  // categories grades as its own category instead of inside the final's mapped one.
  // The solver and the shares read the same normalized setup, so they agree with
  // the grade instead of treating the counted final as not counted.
  const setup = savedSetup ? withFinalExamCategory(savedSetup) : null;
  const choice = chooseGradeEngine(setup);
  const assignments = course.assignments.map((assignment) => ({
    id: assignment.id,
    pointsPossible: assignment.pointsPossible,
    grade: assignment.grade,
  }));

  const grade =
    choice.engine === "weighted"
      ? calculateWeightedGrade(choice.setup, assignments)
      : calculatePointsGrade(assignments);
  // Only an unsupported grade has nothing to break down: the engine gave up
  // on the course as a whole, so per-category figures would be misleading.
  const breakdown =
    choice.engine === "weighted" && grade.status !== "unsupported"
      ? buildCategoryBreakdown(choice.setup, assignments)
      : [];

  // The cutoffs and the picked final both come from the saved setup, so a
  // points course with a confirmed setup can still get final exam planning.
  const finalExam = solveFinalExam({
    choice,
    assignments,
    finalAssignmentId: readFinalExamAssignmentId(setup),
    cutoffs: setup?.cutoffs ?? {},
    finalExamWeight: setup?.finalExamWeight ?? 0,
  });

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
    finalExam,
    shares: assignmentShares(setup, assignments),
  });
}
