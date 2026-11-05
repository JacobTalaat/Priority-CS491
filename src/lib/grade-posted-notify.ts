import { prisma } from "@/lib/prisma";
import { gradePostedMessage } from "@/lib/notification-messages";
import { sendToUser } from "@/lib/notify";

// A grade older than this is history, not news: the sync that detected it ran
// long ago or it predates the feature, so it is claimed without a push.
export const GRADE_PUSH_FRESH_MS = 12 * 60 * 60 * 1000;
// A regrade burst must never fan out into an unbounded push storm.
export const GRADE_PUSH_MAX_PER_RUN = 3;

// Delivery is at-most-once: a duplicate grade push would read as a wrong grade,
// a rare missed one just reads as no push. Everything pending is claimed before
// a single send, so two overlapping runs can never both push the same grade.
export async function deliverGradePostedNotifications(
  userId: string,
  now: Date = new Date(),
): Promise<{ attempted: number; suppressed: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifyGradePosted: true },
  });
  const allowed = user?.notifyGradePosted === true;
  const events = await prisma.gradePostedEvent.findMany({
    where: { userId, notifiedAt: null },
    orderBy: { postedAt: "desc" },
    select: {
      id: true,
      score: true,
      postedAt: true,
      assignment: {
        select: {
          title: true,
          pointsPossible: true,
          course: { select: { name: true } },
        },
      },
    },
  });
  const claimed: Array<(typeof events)[number]> = [];
  for (const event of events) {
    const claim = await prisma.gradePostedEvent.updateMany({
      where: { id: event.id, notifiedAt: null },
      data: { notifiedAt: now },
    });
    if (claim.count === 1) {
      claimed.push(event);
    }
  }
  const cutoff = now.getTime() - GRADE_PUSH_FRESH_MS;
  const fresh = claimed.filter((event) => event.postedAt.getTime() >= cutoff);
  const selected = (allowed ? fresh : []).slice(0, GRADE_PUSH_MAX_PER_RUN);
  await Promise.all(
    selected.map((event) =>
      sendToUser(
        userId,
        gradePostedMessage({
          assignmentTitle: event.assignment.title,
          courseName: event.assignment.course.name,
          score: event.score,
          pointsPossible: event.assignment.pointsPossible,
        }),
      ),
    ),
  );
  return { attempted: selected.length, suppressed: claimed.length - selected.length };
}
