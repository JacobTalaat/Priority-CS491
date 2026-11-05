import { CanvasError } from "@/lib/canvas";
import { getCanvasStatus, getCanvasToken } from "@/lib/canvas-credentials";
import { getCalendarFeedUrl } from "@/lib/calendar-feed-credentials";
import { prisma } from "@/lib/prisma";
import { importAssignmentGroups } from "./assignment-groups";
import { importAssignments } from "./assignments";
import { importCalendarAssignments } from "./calendar-assignments";
import { importCourses } from "./courses";
import { importGrades } from "./grades";

// A lock left behind by a killed process must not wedge the account forever.
const STALE_LOCK_MS = 5 * 60_000;

export type SyncResult = {
  lastSyncedAt: Date;
  courses: number;
  assignmentGroups: number;
  assignments: number;
  grades: number;
  gradesPosted: number;
};

// Both the daily job and the manual "Sync now" route take this lock first, so
// the same student is never imported twice at once.
export async function acquireSyncLock(userId: string): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ syncStartedAt: null }, { syncStartedAt: { lte: new Date(Date.now() - STALE_LOCK_MS) } }],
    },
    data: { syncStartedAt: new Date() },
  });
  return result.count === 1;
}

export async function releaseSyncLock(userId: string): Promise<void> {
  await prisma.user.updateMany({ where: { id: userId }, data: { syncStartedAt: null } });
}

// hand-entered grades are excluded so they never count as posted by Canvas
async function readCurrentCourseScores(userId: string): Promise<Map<string, number>> {
  const assignments = await prisma.assignment.findMany({
    where: { course: { userId, isCurrent: true }, grade: { score: { not: null }, isManual: false } },
    select: { id: true, grade: { select: { score: true } } },
  });
  const scores = new Map<string, number>();
  for (const assignment of assignments) {
    const score = assignment.grade?.score;
    if (typeof score === "number") {
      scores.set(assignment.id, score);
    }
  }
  return scores;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// A grade counts as newly posted only when its score went from absent (or
// null) to a number since the previous snapshot. A unique violation means the
// assignment already has its one event and the regrade is not counted.
async function recordNewlyPostedGrades(userId: string, previous: Map<string, number>): Promise<number> {
  const current = await readCurrentCourseScores(userId);
  let created = 0;
  for (const [assignmentId, score] of current) {
    if (previous.has(assignmentId)) {
      continue;
    }
    try {
      await prisma.gradePostedEvent.create({ data: { userId, assignmentId, score } });
      created += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }
  return created;
}

async function finishSync(
  userId: string,
  snapshot: Map<string, number> | null,
  result: Omit<SyncResult, "gradesPosted">
): Promise<SyncResult> {
  const gradesPosted = snapshot ? await recordNewlyPostedGrades(userId, snapshot) : 0;
  return { ...result, gradesPosted };
}

async function syncFromCalendarFeed(
  userId: string,
  feedUrl: string,
): Promise<Omit<SyncResult, "gradesPosted">> {
  const result = await importCalendarAssignments(userId, feedUrl);
  const lastSyncedAt = new Date();
  await prisma.user.update({ where: { id: userId }, data: { lastSyncedAt } });
  return {
    lastSyncedAt,
    courses: result.courses,
    assignmentGroups: 0,
    assignments: result.imported,
    grades: 0,
  };
}

export async function syncUser(userId: string): Promise<SyncResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastSyncedAt: true },
  });
  // a user whose lastSyncedAt is still null is on their very first sync, so
  // every grade already in Canvas is history, not something newly posted
  const hadSyncedBefore = user?.lastSyncedAt !== null && user?.lastSyncedAt !== undefined;
  const snapshot = hadSyncedBefore ? await readCurrentCourseScores(userId) : null;
  const credentials = await getCanvasToken(userId);
  if (!credentials) {
    // a token we hold but cannot read is a broken credential, not an absent one
    const status = await getCanvasStatus(userId);
    if (status.connected) {
      throw new CanvasError("unauthorized", "Stored Canvas credentials could not be read");
    }
    const feedUrl = await getCalendarFeedUrl(userId);
    if (!feedUrl) {
      throw new Error("Canvas not connected");
    }
    return finishSync(userId, snapshot, await syncFromCalendarFeed(userId, feedUrl));
  }
  try {
    const coursesImported = await importCourses(userId);
    const courses = await prisma.course.findMany({
      where: { userId, id: { in: coursesImported.courseIds } },
    });
    let assignmentGroups = 0;
    let assignments = 0;
    let grades = 0;
    for (const course of courses) {
      const groups = await importAssignmentGroups(credentials, course);
      assignmentGroups += groups.imported;
      const importedAssignments = await importAssignments(credentials, course);
      assignments += importedAssignments.imported;
      const importedGrades = await importGrades(credentials, course);
      grades += importedGrades.imported;
    }
    const lastSyncedAt = new Date();
    await prisma.user.update({ where: { id: userId }, data: { lastSyncedAt } });
    return finishSync(userId, snapshot, {
      lastSyncedAt,
      courses: coursesImported.imported,
      assignmentGroups,
      assignments,
      grades,
    });
  } catch (error) {
    if (!(error instanceof CanvasError) || error.kind === "unauthorized") {
      throw error;
    }
    let feedUrl: string | null;
    try {
      feedUrl = await getCalendarFeedUrl(userId);
    } catch {
      throw error;
    }
    if (!feedUrl) {
      throw error;
    }
    return finishSync(userId, snapshot, await syncFromCalendarFeed(userId, feedUrl));
  }
}
