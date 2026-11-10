import { NextResponse } from "next/server";
import { authenticateRequest, getBearerToken, unauthorized } from "@/lib/auth";
import { deleteAllTotpFactors, verifyStudentTotpCode } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const WRONG_CODE = "That code is not right. Try again.";

// The student turns two factor off from Settings. The route only takes a
// session that has already been through the second factor once (aal2) — and
// then checks the six digit code it was handed against Supabase again, acting
// as the student: holding the code right now is the proof that the person
// asking is the one who can still answer it.
export async function POST(request: Request) {
  const outcome = await authenticateRequest(request, { requireAal2: true });
  if (!outcome.user) {
    return unauthorized();
  }
  const user = outcome.user;
  const authUserId = outcome.authUserId;

  // Checking the code means acting as the student at Supabase, so the request's
  // own access token rides along — not the Supabase account id.
  const token = getBearerToken(request);
  if (!token) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: WRONG_CODE }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: WRONG_CODE }, { status: 400 });
  }
  const { code } = body as { code?: unknown };
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: WRONG_CODE }, { status: 400 });
  }

  const check = await verifyStudentTotpCode(token, code);
  if (check === "rejected") {
    return NextResponse.json({ error: WRONG_CODE }, { status: 400 });
  }
  if (check !== "verified") {
    return NextResponse.json(
      { error: "Could not check the code with the authenticator service. Try again." },
      { status: 500 }
    );
  }

  // The factors go first: if the database step then fails, two factor is off
  // at Supabase — a later recover or re-enable path stays workable — while
  // the reverse order would leave a dead factor behind that keeps asking for
  // codes nobody can answer through Settings.
  try {
    await deleteAllTotpFactors(authUserId);
  } catch {
    return NextResponse.json(
      { error: "Could not turn two factor off. Try again." },
      { status: 500 }
    );
  }

  // One locked transaction turns the whole setup off: the flag and whatever
  // codes are still stored. Two simultaneous turn-offs collapse into one.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
    const row = await tx.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true },
    });
    if (row === null || !row.twoFactorEnabled) {
      return;
    }
    await tx.user.updateMany({ where: { id: user.id }, data: { twoFactorEnabled: false } });
    await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
  });
  return NextResponse.json({ disabled: true });
}
