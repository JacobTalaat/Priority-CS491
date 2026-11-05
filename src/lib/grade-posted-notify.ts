import { prisma } from "@/lib/prisma";
import { gradePostedMessage } from "@/lib/notification-messages";
import { sendToUser } from "@/lib/notify";

// Delivery is at-most-once: a duplicate grade push would read as a wrong grade,
// a rare missed one just reads as no push.
export async function deliverGradePostedNotifications(
  userId: string,
  now: Date = new Date(),
): Promise<{ notified: number; suppressed: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifyGradePosted: true },
  });
  const allowed = user?.notifyGradePosted === true;
  const events = await prisma.gradePostedEvent.findMany({
    where: { userId, notifiedAt: null },
    orderBy: { postedAt: "asc" },
    select: {
      id: true,
      score: true,
      assignment: {
        select: {
          title: true,
          pointsPossible: true,
          course: { select: { name: true } },
        },
      },
    },
  });
  let notified = 0;
  let suppressed = 0;
  for (const event of events) {
    const claim = await prisma.gradePostedEvent.updateMany({
      where: { id: event.id, notifiedAt: null },
      data: { notifiedAt: now },
    });
    if (claim.count !== 1) {
      continue;
    }
    if (!allowed) {
      // Claimed but silent: turning the toggle back on must not flush old grades.
      suppressed += 1;
      continue;
    }
    await sendToUser(
      userId,
      gradePostedMessage({
        assignmentTitle: event.assignment.title,
        courseName: event.assignment.course.name,
        score: event.score,
        pointsPossible: event.assignment.pointsPossible,
      }),
    );
    notified += 1;
  }
  return { notified, suppressed };
}
