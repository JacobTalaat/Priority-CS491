import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

// The browser subscription is made against the server's own VAPID public key, so
// the site never hardcodes a key copy that can drift out of sync.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  return NextResponse.json({ publicKey: env.vapidPublicKey });
}
