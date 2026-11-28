import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { getCanvasStatus } from "@/lib/canvas-credentials";
import { calculateCourseGradeData } from "@/lib/course-grade-data";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const status = await getCanvasStatus(user.id);
  if (!status.connected) {
    return NextResponse.json({ connected: false, courses: [] });
  }

  const courses = await prisma.course.findMany({
    where: { userId: user.id, isCurrent: true },
    select: {
      id: true,
      name: true,
      courseCode: true,
      term: true,
      termEndsAt: true,
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
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({
    connected: true,
    courses: courses.map((course) => ({
      id: course.id,
      name: course.name,
      courseCode: course.courseCode,
      term: course.term,
      termEndsAt: course.termEndsAt,
      grade: calculateCourseGradeData(course.gradeSetup, course.assignments),
    })),
  });
}
