import { NextResponse } from "next/server";
import { authenticateRequest, mfaRequiredResponse, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

// The one route that says why a token was refused: a student with two factor
// on who has only answered their password gets a distinct 401 so the website
// and the iOS app can show the code screen instead of a dead session.
export async function GET(request: Request) {
  const outcome = await authenticateRequest(request);
  if (outcome.mfaRequired) {
    return mfaRequiredResponse();
  }
  if (!outcome.user) {
    return unauthorized();
  }
  return NextResponse.json({ id: outcome.user.id, email: outcome.user.email });
}
