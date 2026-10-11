import { CanvasError } from "@/lib/canvas";
import { getCanvasToken } from "@/lib/canvas-credentials";
import { getCalendarFeedUrl } from "@/lib/calendar-feed-credentials";
import { prisma } from "@/lib/prisma";
import { importAssignmentGroups } from "./assignment-groups";
import { importAssignments } from "./assignments";
import { importCalendarAssignments } from "./calendar-assignments";
import { importCourses } from "./courses";
import { importGrades } from "./grades";

async function syncFromCalendarFeed(
  userId: string,
  feedUrl: string,
): Promise<{ lastSyncedAt: Date; courses: number; assignmentGroups: number; assignments: number; grades: number }> {
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

export async function syncUser(userId: string): Promise<{
  lastSyncedAt: Date;
  courses: number;
  assignmentGroups: number;
  assignments: number;
  grades: number;
}> {
  const credentials = await getCanvasToken(userId);
  if (!credentials) {
    const feedUrl = await getCalendarFeedUrl(userId);
    if (!feedUrl) {
      throw new Error("Canvas not connected");
    }
    return syncFromCalendarFeed(userId, feedUrl);
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
    return { lastSyncedAt, courses: coursesImported.imported, assignmentGroups, assignments, grades };
  } catch (error) {
    if (!(error instanceof CanvasError) && !(error instanceof Error && error.message === "Canvas not connected")) {
      throw error;
    }
    const feedUrl = await getCalendarFeedUrl(userId);
    if (!feedUrl) {
      throw error;
    }
    return syncFromCalendarFeed(userId, feedUrl);
  }
}
