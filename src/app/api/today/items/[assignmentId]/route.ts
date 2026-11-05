import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  clientFromRequest,
  findCurrentAssignment,
  findEventForReplay,
  lockItem,
  recordItemEvent,
  requestIdFromRequest,
} from "@/lib/today-items";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ assignmentId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const { assignmentId } = await context.params;

  const requestId = requestIdFromRequest(request);
  if (!requestId.ok) {
    return NextResponse.json({ error: requestId.error }, { status: 400 });
  }

  const assignment = await findCurrentAssignment(user.id, assignmentId);
  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  }

  // State change and event go in ONE transaction, serialized against
  // concurrent actions on the same item, so neither is ever saved without the
  // other. The tap is logged even when there was no state to remove: it is
  // still what the student did, and the event log is append-only.
  const outcome = await prisma.$transaction(async (tx) => {
    await lockItem(tx, user.id, assignmentId);
    if (requestId.value !== null) {
      const replay = await findEventForReplay(tx, user.id, requestId.value);
      if (replay?.response != null) {
        return replay.response;
      }
    }
    const removed = await tx.itemState.deleteMany({
      where: { userId: user.id, assignmentId },
    });
    const responseBody = { assignmentId, undone: removed.count > 0 };
    await recordItemEvent(tx, {
      userId: user.id,
      assignmentId,
      courseId: assignment.courseId,
      assignmentCanvasId: assignment.canvasId,
      action: "undo",
      client: clientFromRequest(request),
      requestId: requestId.value,
      shownRank: null,
      listGeneratedAt: null,
      serverRank: null,
      response: responseBody,
    });
    return responseBody;
  });

  return NextResponse.json(outcome);
}
