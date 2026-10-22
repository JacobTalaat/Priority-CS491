import type { Prisma } from "@/generated/prisma/client";
import { loadOpenWork } from "@/lib/ranking-data";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

// The clients that send X-Priority-Client; anything else, or no header at all,
// is recorded as "unknown" rather than guessed.
export type PriorityClient = "web" | "app" | "unknown";

export function clientFromRequest(request: Request): PriorityClient {
  const header = request.headers.get("x-priority-client");
  return header === "web" || header === "app" ? header : "unknown";
}

// What a caller sent that the route reads and validates.
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// The idempotency key a retried request replays with. Absent is fine; present
// must be at most 100 characters so one long header cannot pile into the log.
const MAX_REQUEST_ID_LENGTH = 100;

export function requestIdFromRequest(request: Request): Parsed<string | null> {
  const header = request.headers.get("x-priority-request-id");
  if (header === null || header.trim() === "") {
    return { ok: true, value: null };
  }
  const trimmed = header.trim();
  if (trimmed.length > MAX_REQUEST_ID_LENGTH) {
    return { ok: false, error: "requestId must be at most 100 characters." };
  }
  return { ok: true, value: trimmed };
}

export type ActionBody = { rank: number | null; listGeneratedAt: Date | null };

// The optional body done and skip accept, saying what the client displayed
// when the student tapped: the item's rank and the today list's generatedAt.
// No body at all is fine; a body that is not an object or carries invalid
// field values is rejected with the message given.
export function parseActionBody(body: unknown): Parsed<ActionBody> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const fields = body as Record<string, unknown>;

  let rank: number | null = null;
  if (fields.rank !== undefined) {
    if (typeof fields.rank !== "number" || !Number.isInteger(fields.rank) || fields.rank < 1) {
      return { ok: false, error: "rank must be a positive integer." };
    }
    rank = fields.rank;
  }

  let listGeneratedAt: Date | null = null;
  if (fields.listGeneratedAt !== undefined) {
    if (typeof fields.listGeneratedAt !== "string" || fields.listGeneratedAt === "") {
      return { ok: false, error: "listGeneratedAt must be an ISO date-time." };
    }
    const parsed = new Date(fields.listGeneratedAt);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "listGeneratedAt must be an ISO date-time." };
    }
    listGeneratedAt = parsed;
  }

  return { ok: true, value: { rank, listGeneratedAt } };
}

// A to-do action is only ever about an assignment of one of the caller's
// CURRENT courses: anything else must not be reachable, so callers 404 on it.
// courseId and canvasId ride along for the event log, which outlives the
// assignment row.
export async function findCurrentAssignment(userId: string, assignmentId: string) {
  return prisma.assignment.findFirst({
    where: { id: assignmentId, course: { userId, isCurrent: true } },
    select: { id: true, courseId: true, canvasId: true },
  });
}

// The server-side rank at the time of the action: where the item sits in what
// loadOpenWork gives this user right now, or null when it is not in the list
// (hidden already, undated, or no longer open).
export async function serverRankOf(userId: string, assignmentId: string, now: Date): Promise<number | null> {
  const ranked = await loadOpenWork(userId, now);
  const index = ranked.findIndex((item) => item.assignmentId === assignmentId);
  return index === -1 ? null : index + 1;
}

// Serialise actions on one (user, assignment) pair: two clients doing done and
// undo at the same moment otherwise could interleave their state writings and
// event rows. The advisory lock is keyed on the pair and releases when the
// transaction ends, so no other action on the same item can run between this
// transaction's state change and its event.
export async function lockItem(tx: Tx, userId: string, assignmentId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext(${assignmentId}))`;
}

// A retried request with the same idempotency key must return the response the
// first attempt returned and change nothing further.
export async function findEventForReplay(tx: Tx, userId: string, requestId: string) {
  return tx.itemEvent.findUnique({
    where: { userId_requestId: { userId, requestId } },
    select: { response: true },
  });
}

export type ItemEventFields = {
  userId: string;
  assignmentId: string;
  courseId: string;
  assignmentCanvasId: string;
  action: string;
  client: PriorityClient;
  requestId: string | null;
  shownRank: number | null;
  listGeneratedAt: Date | null;
  serverRank: number | null;
  response: Prisma.InputJsonValue;
};

export async function recordItemEvent(tx: Tx, fields: ItemEventFields) {
  return tx.itemEvent.create({
    data: {
      userId: fields.userId,
      assignmentId: fields.assignmentId,
      courseId: fields.courseId,
      assignmentCanvasId: fields.assignmentCanvasId,
      action: fields.action,
      client: fields.client,
      requestId: fields.requestId,
      shownRank: fields.shownRank,
      listGeneratedAt: fields.listGeneratedAt,
      serverRank: fields.serverRank,
      response: fields.response,
    },
  });
}
