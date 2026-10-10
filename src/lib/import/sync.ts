import { getCanvasToken } from "@/lib/canvas-credentials";
import { prisma } from "@/lib/prisma";
import { importAssignmentGroups } from "./assignment-groups";
import { importAssignments } from "./assignments";
import { importCourses } from "./courses";
import { importGrades } from "./grades";

export async function syncUser(userId: string): Promise<{
  lastSyncedAt: Date;
  courses: number;
  assignmentGroups: number;
  assignments: number;
  grades: number;
}> {
  const credentials = await getCanvasToken(userId);
  if (!credentials) {
    throw new Error("Canvas not connected");
  }
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
}
