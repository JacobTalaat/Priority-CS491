import { createHash } from "node:crypto";
import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AskClassesResult, AskClassesSource } from "@/lib/ask-classes";

// Console output is captured by log-safety checks; never echo question text here.
const LOG_FAILURE_MESSAGE = "Failed to store ask question log";

// Every question that reached the answering step is stored, including AI
// outcomes that produced no answer ("failed", "cap-reached"), so the study can
// tell answer accuracy apart from answer volume. Only questions that never
// reached that step (validation errors, a foreign courseId) are excluded.
// A logging failure must not disturb the user's response, so it is swallowed.
export async function logAskOutcome({
  userId,
  question,
  courseId,
  result,
}: {
  userId: string;
  question: string;
  courseId?: string;
  result: AskClassesResult;
}): Promise<void> {
  if (!result.ok && result.reason === "invalid-question") {
    return;
  }
  const found = result.ok && result.found;
  try {
    await prisma.askLog.create({
      data: {
        userId,
        question: question.trim(),
        outcome: outcomeFor(result),
        answer: found ? result.answer : null,
        found,
        sourceCount: found ? result.sources.length : 0,
        courseId: courseId ?? null,
        sources: found ? result.sources : Prisma.DbNull,
      },
    });
  } catch {
    console.error(LOG_FAILURE_MESSAGE);
  }
}

function outcomeFor(result: AskClassesResult): string {
  if (!result.ok) {
    return result.reason;
  }
  return result.found ? "found" : "not-found";
}

// The study compares accuracy across students without showing who they are, so
// each row carries a hash of the student's id instead of the id. It is
// pseudonymous, not anonymous: anyone holding the database can recompute it, and
// a question's own text can still identify its author.
const STUDENT_KEY_PREFIX = "asklog-";

function studentKeyFor(userId: string): string {
  return STUDENT_KEY_PREFIX + createHash("sha256").update(userId).digest("hex");
}

export type AskLogRow = {
  studentKey: string;
  question: string;
  outcome: string;
  answer: string | null;
  found: boolean;
  sourceCount: number;
  courseId: string | null;
  sources: AskClassesSource[] | null;
  createdAt: Date;
};

export async function getAskLog({
  from,
  to,
}: {
  from?: Date;
  to?: Date;
} = {}): Promise<AskLogRow[]> {
  const window = {
    ...(from !== undefined ? { gte: from } : {}),
    ...(to !== undefined ? { lte: to } : {}),
  };
  const rows = await prisma.askLog.findMany({
    where: Object.keys(window).length > 0 ? { createdAt: window } : {},
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    studentKey: studentKeyFor(row.userId),
    question: row.question,
    outcome: row.outcome,
    answer: row.answer,
    found: row.found,
    sourceCount: row.sourceCount,
    courseId: row.courseId,
    sources: (row.sources as AskLogRow["sources"]) ?? null,
    createdAt: row.createdAt,
  }));
}
