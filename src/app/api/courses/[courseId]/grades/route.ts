import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };

const ASSIGNMENT_NOT_FOUND_ERROR = "Assignment not found in this course.";
const MISSING_GRADE_ERROR = "No grade is saved for this assignment.";
// deleting or editing a Canvas grade would only be undone on the next sync
const CANVAS_GRADE_ERROR = "This grade comes from Canvas, so it can't be edited or deleted here.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ManualGradeInput = { assignmentId: string; score: number };

function parseManualGradeBody(
  body: unknown
): { ok: true; data: ManualGradeInput } | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Send the grade as JSON with an assignment and a score." };
  }
  if (typeof body.assignmentId !== "string" || body.assignmentId.length === 0) {
    return { ok: false, error: "Choose the assignment this grade belongs to." };
  }
  if (typeof body.score !== "number" || !Number.isFinite(body.score)) {
    return { ok: false, error: "Enter a score as a number." };
  }
  if (body.score < 0) {
    return { ok: false, error: "A score can't be below zero." };
  }
  return { ok: true, data: { assignmentId: body.assignmentId, score: body.score } };
}

type ResolvedAssignment =
  | { ok: true; assignment: { id: string; pointsPossible: number } }
  | { ok: false; response: NextResponse };

async function resolveAssignment(
  userId: string,
  courseId: string,
  assignmentId: string
): Promise<ResolvedAssignment> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId, isCurrent: true },
    select: { id: true },
  });
  if (!course) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Current course not found." }, { status: 404 }),
    };
  }
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, courseId: course.id },
    select: { id: true, pointsPossible: true },
  });
  if (!assignment) {
    return {
      ok: false,
      response: NextResponse.json({ error: ASSIGNMENT_NOT_FOUND_ERROR }, { status: 404 }),
    };
  }
  return { ok: true, assignment };
}

async function readManualGradeBody(request: Request): Promise<ManualGradeInput | NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = parseManualGradeBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  return parsed.data;
}

async function readDeletedAssignmentId(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("assignmentId");
  if (fromQuery) {
    return fromQuery;
  }
  try {
    const body: unknown = await request.json();
    if (isRecord(body) && typeof body.assignmentId === "string" && body.assignmentId.length > 0) {
      return body.assignmentId;
    }
  } catch {
    // without a JSON body the query string is the only input
  }
  return null;
}

async function existingManualGrade(assignmentId: string) {
  const grade = await prisma.grade.findUnique({ where: { assignmentId } });
  if (!grade) {
    return NextResponse.json({ error: MISSING_GRADE_ERROR }, { status: 404 });
  }
  if (!grade.isManual) {
    return NextResponse.json({ error: CANVAS_GRADE_ERROR }, { status: 409 });
  }
  return null;
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const input = await readManualGradeBody(request);
  if (input instanceof NextResponse) {
    return input;
  }

  const { courseId } = await context.params;
  const resolved = await resolveAssignment(user.id, courseId, input.assignmentId);
  if (!resolved.ok) {
    return resolved.response;
  }

  const gradedAt = new Date();
  const grade = await prisma.grade.upsert({
    where: { assignmentId: resolved.assignment.id },
    create: { assignmentId: resolved.assignment.id, score: input.score, gradedAt, isManual: true },
    update: { score: input.score, gradedAt, isManual: true },
  });
  return NextResponse.json({ grade });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const input = await readManualGradeBody(request);
  if (input instanceof NextResponse) {
    return input;
  }

  const { courseId } = await context.params;
  const resolved = await resolveAssignment(user.id, courseId, input.assignmentId);
  if (!resolved.ok) {
    return resolved.response;
  }
  const refused = await existingManualGrade(resolved.assignment.id);
  if (refused) {
    return refused;
  }

  const gradedAt = new Date();
  const grade = await prisma.grade.update({
    where: { assignmentId: resolved.assignment.id },
    data: { score: input.score, gradedAt },
  });
  return NextResponse.json({ grade });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const assignmentId = await readDeletedAssignmentId(request);
  if (!assignmentId) {
    return NextResponse.json(
      { error: "Choose the assignment whose grade you want to delete." },
      { status: 400 },
    );
  }

  const { courseId } = await context.params;
  const resolved = await resolveAssignment(user.id, courseId, assignmentId);
  if (!resolved.ok) {
    return resolved.response;
  }
  const refused = await existingManualGrade(resolved.assignment.id);
  if (refused) {
    return refused;
  }

  await prisma.grade.delete({ where: { assignmentId: resolved.assignment.id } });
  return NextResponse.json({ deleted: true });
}
