import { NextResponse } from "next/server";
import { getCanvasStatus } from "@/lib/canvas-credentials";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { categoryGradeSummaries } from "@/lib/course-grade-summary";
import { parseGradeSetup } from "@/lib/grade-setup";
import { prisma } from "@/lib/prisma";
import { calculateWeightedGrade } from "@/lib/weighted-grade";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const canvasStatus = await getCanvasStatus(user.id);
  if (!canvasStatus.connected) {
    return NextResponse.json({ connected: false, courses: [] });
  }

  const courses = await prisma.course.findMany({
    where: { userId: user.id, isCurrent: true },
    select: {
      id: true,
      name: true,
      courseCode: true,
      term: true,
      assignments: {
        select: {
          id: true,
          title: true,
          dueAt: true,
          pointsPossible: true,
          grade: { select: { score: true } },
        },
        orderBy: [{ dueAt: "asc" }, { title: "asc" }, { id: "asc" }],
      },
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
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const now = new Date();
  const cards = courses.map((course) => {
    const nextDue = course.assignments.find(
      (assignment) => assignment.dueAt !== null && assignment.dueAt >= now,
    );
    const nextDueAt = nextDue?.dueAt;
    const parsedSetup = course.gradeSetup
      ? parseGradeSetup({
          categories: course.gradeSetup.categories,
          assignmentMappings: course.gradeSetup.assignmentMappings,
          finalExamWeight: course.gradeSetup.finalExamWeight,
          cutoffs: course.gradeSetup.cutoffs,
          classDetails: course.gradeSetup.classDetails,
        })
      : null;
    const setup = parsedSetup?.ok ? parsedSetup.data : null;
    const grade = setup
      ? calculateWeightedGrade(setup, course.assignments)
      : {
          status: "unsupported" as const,
          reason: course.gradeSetup ? "invalid-setup" : "no-confirmed-setup",
        };

    return {
      id: course.id,
      name: course.name,
      courseCode: course.courseCode,
      term: course.term,
      confirmed: course.gradeSetup !== null,
      grade,
      categoryBreakdown: setup ? categoryGradeSummaries(setup, course.assignments) : [],
      nextDue: nextDue && nextDueAt
        ? { title: nextDue.title, dueAt: nextDueAt.toISOString() }
        : null,
    };
  });

  return NextResponse.json({ connected: true, courses: cards });
}
