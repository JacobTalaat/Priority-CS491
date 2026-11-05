import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/auth";
import { env } from "@/lib/env";

// The job is protected by a shared secret, not by an app session, so any
// scheduler can carry a single header. Compare in constant time once the
// lengths match, and answer 503 when the secret was never set up.
export const CRON_SECRET_NOT_CONFIGURED_MESSAGE =
  "Daily sync is not configured. Set CRON_SECRET to at least 32 characters.";

export type CronSecretCheck = { ok: true } | { ok: false; response: NextResponse };

export function checkCronSecret(request: Request): CronSecretCheck {
  let expected: string;
  try {
    expected = env.cronSecret;
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: CRON_SECRET_NOT_CONFIGURED_MESSAGE }, { status: 503 }),
    };
  }
  const header = request.headers.get("authorization");
  if (header) {
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token) {
      const presented = Buffer.from(token);
      const expectedBuffer = Buffer.from(expected);
      if (presented.length === expectedBuffer.length && timingSafeEqual(presented, expectedBuffer)) {
        return { ok: true };
      }
    }
  }
  return { ok: false, response: unauthorized() };
}
