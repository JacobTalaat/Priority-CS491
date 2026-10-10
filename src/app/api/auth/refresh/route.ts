import { NextResponse } from "next/server";
import { getSessionFromRequest, rotateSession, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return unauthorized();
  }
  const { token, expiresAt } = await rotateSession(session.id, session.user.id);
  return NextResponse.json({
    token,
    expiresAt,
    user: { id: session.user.id, email: session.user.email },
  });
}
