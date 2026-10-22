import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDetails(
  gradeSetup: { classDetails: unknown; confirmedAt: Date } | null
): {
  instructor: string | null;
  section: string | null;
  credits: number | null;
  officeHours: string | null;
  latePolicy: string | null;
  contacts: string | null;
  confirmedAt: Date | null;
} {
  if (!gradeSetup || !isPlainObject(gradeSetup.classDetails)) {
    return {
      instructor: null,
      section: null,
      credits: null,
      officeHours: null,
      latePolicy: null,
      contacts: null,
      confirmedAt: null,
    };
  }
  const details = gradeSetup.classDetails;
  const text = (key: string) => {
    const value = details[key];
    return typeof value === "string" ? value : null;
  };
  const credits = details.credits;
  return {
    instructor: text("instructor"),
    section: text("section"),
    credits: typeof credits === "number" && Number.isFinite(credits) ? credits : null,
    officeHours: text("officeHours"),
    latePolicy: text("latePolicy"),
    contacts: text("contacts"),
    confirmedAt: gradeSetup.confirmedAt,
  };
}

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
      name: true,
      courseCode: true,
      term: true,
      termEndsAt: true,
      gradeSetup: { select: { classDetails: true, confirmedAt: true } },
      assignments: {
        select: {
          id: true,
          title: true,
          dueAt: true,
          hasDueDate: true,
          pointsPossible: true,
          htmlUrl: true,
          assignmentGroup: { select: { name: true } },
          grade: { select: { score: true, gradedAt: true } },
        },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { title: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!course) {
    return NextResponse.json({ error: "Current course not found." }, { status: 404 });
  }

  return NextResponse.json({
    course: {
      id: course.id,
      name: course.name,
      courseCode: course.courseCode,
      term: course.term,
      termEndsAt: course.termEndsAt,
    },
    details: readDetails(course.gradeSetup),
    assignments: course.assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      dueAt: assignment.dueAt,
      hasDueDate: assignment.hasDueDate,
      pointsPossible: assignment.pointsPossible,
      htmlUrl: assignment.htmlUrl,
      assignmentGroup: assignment.assignmentGroup,
      // A grade row can now exist before a score does (the work was handed in or excused),
      // but this response has always meant "graded" by a non-null grade, so it stays null
      // until a score lands.
      grade: assignment.grade && assignment.grade.score !== null ? assignment.grade : null,
    })),
  });
}
