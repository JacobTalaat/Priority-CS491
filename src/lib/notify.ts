import { prisma } from "@/lib/prisma";
import { sendPush, type PushMessage } from "@/lib/web-push";

export type SendCounts = { sent: number; failed: number; removed: number };

export async function sendToUser(userId: string, message: PushMessage): Promise<SendCounts> {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  // The batch finishes in one parallel round, and a send that explodes on its
  // own still lets every other one be counted.
  const outcomes = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        return await sendPush(subscription, message);
      } catch {
        console.error("Web push send failed.");
        return "failed" as const;
      }
    }),
  );
  const counts: SendCounts = { sent: 0, failed: 0, removed: 0 };
  for (const outcome of outcomes) {
    counts[outcome] += 1;
  }
  return counts;
}
