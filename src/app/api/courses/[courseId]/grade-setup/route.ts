import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { parseGradeSetup } from "@/lib/grade-setup";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = parseGradeSetup(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { courseId } = await context.params;
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: user.id, isCurrent: true },
    select: { id: true },
  });
  if (!course) {
    return NextResponse.json({ error: "Current course not found." }, { status: 404 });
  }

  const assignments = await prisma.assignment.findMany({
    where: { courseId: course.id },
    select: { id: true },
  });
  const assignmentIds = new Set(assignments.map((assignment) => assignment.id));
  for (const mapping of parsed.data.assignmentMappings) {
    if (!assignmentIds.has(mapping.assignmentId)) {
      return NextResponse.json(
        { error: "An assignment mapping does not belong to this course." },
        { status: 400 },
      );
    }
  }
  if (parsed.data.assignmentMappings.length !== assignmentIds.size) {
    return NextResponse.json(
      { error: "Map every assignment in this course before confirming the setup." },
      { status: 400 },
    );
  }

  const confirmedAt = new Date();
  // Only an explicit unsupportedRules list replaces what is saved; a body that omits the
  // field keeps the saved rules, because leaving them out does not mean there are none.
  // On create there is no saved row, so an omitted field starts at the empty default.
  const { unsupportedRules, ...setupFields } = parsed.data;
  await prisma.courseGradeSetup.upsert({
    where: { courseId: course.id },
    create: { courseId: course.id, ...setupFields, unsupportedRules: unsupportedRules ?? [], confirmedAt },
    update: {
      ...setupFields,
      confirmedAt,
      ...(unsupportedRules === undefined ? {} : { unsupportedRules }),
    },
  });
  return NextResponse.json({ confirmed: true, courseId: course.id, confirmedAt });
}
