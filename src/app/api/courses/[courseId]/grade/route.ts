import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { calculateCourseGrade } from "@/lib/course-grade";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const { courseId } = await context.params;
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: user.id, isCurrent: true },
    select: {
      id: true,
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
          pointsPossible: true,
          grade: { select: { score: true } },
        },
      },
    },
  });
  if (!course) {
    return NextResponse.json({ error: "Current course not found." }, { status: 404 });
  }

  const result = calculateCourseGrade(
    course.gradeSetup,
    course.assignments.map((assignment) => ({
      id: assignment.id,
      pointsPossible: assignment.pointsPossible,
      score: assignment.grade?.score ?? null,
    })),
  );
  return NextResponse.json({ courseId: course.id, ...result });
}
