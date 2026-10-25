import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const courses = await prisma.course.findMany({
    where: { userId: user.id, isCurrent: true },
    select: {
      id: true,
      name: true,
      courseCode: true,
      assignments: {
        select: {
          id: true,
          title: true,
          dueAt: true,
          hasDueDate: true,
          pointsPossible: true,
          grade: { select: { score: true } },
        },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const assignments = courses.flatMap((course) =>
    course.assignments
      .filter((assignment) => assignment.grade?.score == null)
      .map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        dueAt: assignment.dueAt,
        hasDueDate: assignment.hasDueDate,
        pointsPossible: assignment.pointsPossible,
        course: { id: course.id, name: course.name, courseCode: course.courseCode },
      })),
  );
  assignments.sort((left, right) => {
    if (left.dueAt === null && right.dueAt !== null) return 1;
    if (left.dueAt !== null && right.dueAt === null) return -1;
    if (left.dueAt !== null && right.dueAt !== null) {
      const dueDifference = left.dueAt.getTime() - right.dueAt.getTime();
      if (dueDifference !== 0) return dueDifference;
    }
    return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  });

  return NextResponse.json({ assignments });
}
