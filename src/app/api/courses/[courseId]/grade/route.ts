import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateCourseGradeData, type CourseGradeData } from "@/lib/course-grade-data";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };

type GradeResponse = {
  course: {
    id: string;
    name: string;
    courseCode: string | null;
    term: string | null;
  };
} & CourseGradeData;

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

  const assignments = course.assignments.map((assignment) => ({
    id: assignment.id,
    pointsPossible: assignment.pointsPossible,
    grade: assignment.grade,
  }));
  const gradeData = calculateCourseGradeData(course.gradeSetup, assignments);

  return NextResponse.json({
    course: {
      id: course.id,
      name: course.name,
      courseCode: course.courseCode,
      term: course.term,
    },
    ...gradeData,
  });
}
