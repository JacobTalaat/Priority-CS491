import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  checkAndReserveTestSend,
  refundTestSend,
} from "@/lib/push-test-limit";
import { sendPush } from "@/lib/web-push";

export const dynamic = "force-dynamic";

const TEST_MESSAGE = {
  title: "Priority",
  body: "Notifications are on.",
  url: "/today",
} as const;

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  // Reservation happens in the same synchronous step as the check, so two
  // requests racing for the last slot cannot both get through.
  const limit = checkAndReserveTestSend(user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many test notifications. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subscriptions.length === 0) {
    // Nothing was sent, so the reserved slot goes back to the window.
    refundTestSend(user.id);
    return NextResponse.json(
      { error: "No saved browser subscription. Turn notifications on first." },
      { status: 404 }
    );
  }

  // The cap is ten subscriptions, so the whole batch finishes in one round trip
  // and a send that explodes on its own still lets every other one be counted.
  const outcomes = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        return await sendPush(subscription, TEST_MESSAGE);
      } catch {
        // sendPush is hardened, but a stray throw must not lose the other counts.
        console.error("Web push send failed.");
        return "failed" as const;
      }
    }),
  );

  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const outcome of outcomes) {
    if (outcome === "sent") {
      sent += 1;
    } else if (outcome === "removed") {
      removed += 1;
    } else {
      failed += 1;
    }
  }
  return NextResponse.json({ sent, failed, removed });
}
