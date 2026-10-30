import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { answerQuestion } from "@/lib/ask-classes";
import { logAskOutcome } from "@/lib/ask-log";

export const dynamic = "force-dynamic";

const NOT_FOUND_MESSAGE = "Priority couldn't find that in your syllabus or Canvas data.";
const CAP_MESSAGE =
  "Priority's AI budget for this month is used up, so it couldn't answer. Try again later.";
const FAILED_MESSAGE = "Priority couldn't answer that right now. Try again.";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { question, courseId } = body as Record<string, unknown>;
  if (typeof question !== "string") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const hasCourseId = courseId !== undefined;
  if (hasCourseId && typeof courseId !== "string") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (hasCourseId) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, userId: user.id, isCurrent: true },
      select: { id: true },
    });
    if (!course) {
      return NextResponse.json({ error: "Current course not found." }, { status: 404 });
    }
  }

  const result = await answerQuestion({
    userId: user.id,
    question,
    courseId: hasCourseId ? courseId : undefined,
  });

  await logAskOutcome({
    userId: user.id,
    question,
    courseId: hasCourseId ? courseId : undefined,
    result,
  });

  if (!result.ok) {
    if (result.reason === "invalid-question") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    if (result.reason === "cap-reached") {
      return NextResponse.json({ error: CAP_MESSAGE }, { status: 503 });
    }
    return NextResponse.json({ error: FAILED_MESSAGE }, { status: 502 });
  }
  if (!result.found) {
    return NextResponse.json({ found: false, message: NOT_FOUND_MESSAGE });
  }
  return NextResponse.json({ found: true, answer: result.answer, sources: result.sources });
}
