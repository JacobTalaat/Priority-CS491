import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { PLAN_MAX_HOURS, PLAN_MIN_HOURS, planAssignment } from "@/lib/plan-steps";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assignmentId: string }> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, context: RouteContext) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  // The body is optional: an empty body plans without a tonight-hours limit.
  let body: Record<string, unknown> = {};
  const raw = await request.text();
  if (raw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    if (!isPlainObject(parsed)) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    body = parsed;
  }

  let hoursAvailable: number | null = null;
  const rawHours = body.hoursAvailable;
  if (rawHours !== undefined) {
    if (
      typeof rawHours !== "number" ||
      !Number.isFinite(rawHours) ||
      rawHours < PLAN_MIN_HOURS ||
      rawHours > PLAN_MAX_HOURS
    ) {
      return NextResponse.json(
        { error: "Send hoursAvailable as a number of hours between 0.5 and 12." },
        { status: 400 },
      );
    }
    hoursAvailable = rawHours;
  }

  const { assignmentId } = await context.params;
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, course: { userId: user.id, isCurrent: true } },
    select: {
      title: true,
      description: true,
      dueAt: true,
      hasDueDate: true,
      pointsPossible: true,
    },
  });
  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  }

  const result = await planAssignment(
    {
      title: assignment.title,
      description: assignment.description,
      dueAt: assignment.dueAt,
      hasDueDate: assignment.hasDueDate,
      pointsPossible: assignment.pointsPossible,
      hoursAvailable,
    },
    user.id
  );
  if (!result.ok) {
    // A used-up monthly budget is an app state (503); every other AI failure is upstream (502).
    return NextResponse.json({ error: result.error }, { status: result.capReached ? 503 : 502 });
  }
  return NextResponse.json({
    steps: result.steps,
    totalMinutes: result.steps.reduce((sum, step) => sum + step.minutes, 0),
  });
}
