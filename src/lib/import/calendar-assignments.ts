import { fetchCalendarFeed } from "@/lib/calendar-feed";
import { prisma } from "@/lib/prisma";

export async function importCalendarAssignments(
  userId: string,
  feedUrl: string,
): Promise<{ imported: number; skipped: number; courses: number }> {
  const courses = await prisma.course.findMany({
    where: { userId, isCurrent: true },
    select: { id: true, canvasId: true },
  });
  const courseByCanvasId = new Map(courses.map((course) => [course.canvasId, course]));
  const events = await fetchCalendarFeed(feedUrl);
  let imported = 0;
  let skipped = 0;

  for (const event of events) {
    const course = courseByCanvasId.get(event.courseCanvasId);
    if (!course) {
      skipped += 1;
      continue;
    }
    const data = {
      title: event.title,
      dueAt: event.dueAt,
      hasDueDate: true,
      pointsPossible: 0,
      htmlUrl: event.htmlUrl,
      assignmentGroupId: null,
    };
    await prisma.assignment.upsert({
      where: {
        courseId_canvasId: {
          courseId: course.id,
          canvasId: event.assignmentCanvasId,
        },
      },
      create: { courseId: course.id, canvasId: event.assignmentCanvasId, ...data },
      update: data,
    });
    imported += 1;
  }
  return { imported, skipped, courses: courses.length };
}
