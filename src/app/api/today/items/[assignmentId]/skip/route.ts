import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { nyDayOf } from "@/lib/ny-day";
import { prisma } from "@/lib/prisma";
import {
  clientFromRequest,
  findCurrentAssignment,
  findEventForReplay,
  lockItem,
  parseActionBody,
  recordItemEvent,
  requestIdFromRequest,
  serverRankOf,
} from "@/lib/today-items";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assignmentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const { assignmentId } = await context.params;

  const requestId = requestIdFromRequest(request);
  if (!requestId.ok) {
    return NextResponse.json({ error: requestId.error }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // No body sent: the displayed rank and list stay unknown.
    body = {};
  }
  const parsed = parseActionBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const assignment = await findCurrentAssignment(user.id, assignmentId);
  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  }

  // Rank as the server saw the list at the moment of the tap, before any state
  // change this request might make.
  const serverRank = await serverRankOf(user.id, assignmentId, new Date());

  // Skipping stores the New York day it applies to, so the item reappears at
  // midnight ET instead of staying hidden forever. It must never overwrite a
  // done state — done only leaves through undo. State change and event go in
  // ONE transaction, serialized against concurrent actions on the same item,
  // so neither is ever saved without the other.
  const skippedDay = nyDayOf(new Date());
  const outcome = await prisma.$transaction(async (tx) => {
    await lockItem(tx, user.id, assignmentId);
    if (requestId.value !== null) {
      const replay = await findEventForReplay(tx, user.id, requestId.value);
      if (replay?.response != null) {
        return replay.response;
      }
    }
    const current = await tx.itemState.findUnique({
      where: { userId_assignmentId: { userId: user.id, assignmentId } },
      select: { status: true },
    });
    const status = current?.status === "done" ? "done" : "skipped";
    if (status === "skipped") {
      await tx.itemState.upsert({
        where: { userId_assignmentId: { userId: user.id, assignmentId } },
        update: { status, skippedDay },
        create: { userId: user.id, assignmentId, status, skippedDay },
      });
    }
    const responseBody = { assignmentId, status };
    await recordItemEvent(tx, {
      userId: user.id,
      assignmentId,
      courseId: assignment.courseId,
      assignmentCanvasId: assignment.canvasId,
      action: "skip",
      client: clientFromRequest(request),
      requestId: requestId.value,
      shownRank: parsed.value.rank,
      listGeneratedAt: parsed.value.listGeneratedAt,
      serverRank,
      response: responseBody,
    });
    return responseBody;
  });

  return NextResponse.json(outcome);
}
