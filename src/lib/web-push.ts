import webpush from "web-push";
import { env } from "@/lib/env";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";
import { prisma } from "@/lib/prisma";

export type PushMessage = {
  title: string;
  body: string;
  url: string;
};

export type PushTarget = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

// 12 hours: a browser that was offline for a day must not receive stale nudges.
export const PUSH_TTL_SECONDS = 12 * 60 * 60;
// Bounded so the nightly job never hangs on a black-holing push service.
export const PUSH_TIMEOUT_MS = 10000;

export type PushOutcome = "sent" | "failed" | "removed";

function vapidDetails() {
  return {
    subject: env.vapidSubject,
    publicKey: env.vapidPublicKey,
    privateKey: env.vapidPrivateKey,
  };
}

// Only 404 and 410 mean the browser subscription is gone; everything else is
// transient trouble the next send may survive, so the row stays (its
// failureCount grows for observability) and the outcome is "failed".
async function handleSendFailure(target: PushTarget, error: unknown): Promise<PushOutcome> {
  if (!(error instanceof Error) || typeof (error as { statusCode?: number }).statusCode !== "number") {
    console.error("Web push request could not be built or sent.");
  } else {
    console.error("Web push send failed.");
  }
  await prisma.pushSubscription.updateMany({
    where: { id: target.id, endpoint: target.endpoint },
    data: { failureCount: { increment: 1 } },
  });
  return "failed";
}

export async function sendPush(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
  try {
    if (!isAllowedPushEndpoint(target.endpoint)) {
      // A row pointing off the allowlist is stale or forged; delete it like a
      // 410 so the caller's removed count reflects the cleanup.
      await prisma.pushSubscription.deleteMany({ where: { id: target.id, endpoint: target.endpoint } });
      return "removed";
    }
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          TTL: PUSH_TTL_SECONDS,
          timeout: PUSH_TIMEOUT_MS,
          vapidDetails: vapidDetails(),
        },
      );
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The push service uninstalled this browser: the row can never succeed again.
        await prisma.pushSubscription.deleteMany({ where: { id: target.id, endpoint: target.endpoint } });
        return "removed";
      }
      return await handleSendFailure(target, error);
    }
    await prisma.pushSubscription.updateMany({
      where: { id: target.id, endpoint: target.endpoint },
      data: { failureCount: 0, lastSuccessAt: new Date() },
    });
    return "sent";
  } catch (error) {
    // Database trouble must not escalate past this helper: the caller counts
    // one send per subscription no matter what happened behind it. web-push
    // failures can echo request details, so the log stays a fixed line that
    // never carries the endpoint or keys.
    console.error("Web push send failed.");
    void error;
    return "failed";
  }
}
