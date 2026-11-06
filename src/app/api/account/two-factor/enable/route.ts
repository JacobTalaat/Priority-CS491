import { NextResponse } from "next/server";
import { authenticateRequest, unauthorized } from "@/lib/auth";
import {
  RECOVERY_CODE_COUNT,
  generatedCodeHash,
  generateRecoveryCodes,
} from "@/lib/two-factor-codes";
import { listVerifiedTotpFactors } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Turning two factor on needs the strongest session there is: the student has
// just verified the QR code in the browser, so their token is aal2, proving
// they hold the second factor they are switching on.
export async function POST(request: Request) {
  const outcome = await authenticateRequest(request, { requireAal2: true });
  if (!outcome.user) {
    return unauthorized();
  }
  const user = outcome.user;
  // The enforceable half of two factor lives at Supabase, so a setup without
  // a verified factor there would lock the student out of everything while
  // protecting them with nothing.
  const verifiedTotps = await listVerifiedTotpFactors(outcome.authUserId);
  if (verifiedTotps.length === 0) {
    return NextResponse.json(
      { error: "No verified authenticator app was found. Scan the QR code and verify it first." },
      { status: 400 }
    );
  }
  // Only hashes of the codes are stored; the plaintext codes go to the
  // student exactly once in this response and are never written or logged.
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  // One locked transaction: read the flag, replace any stored codes and
  // switch the flag on as a single all-or-nothing write. A failure anywhere
  // rolls the whole thing back — the flag stays off and old codes stay put —
  // and a student who is already on runs nothing at all.
  const enabled = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
    const row = await tx.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true },
    });
    if (row === null || row.twoFactorEnabled) {
      return false;
    }
    // Earlier halves of abandoned setups are replaced, never appended to.
    await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.recoveryCode.createMany({
      data: codes.map((code) => ({ userId: user.id, codeHash: generatedCodeHash(code) })),
    });
    await tx.user.updateMany({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    return true;
  });
  if (!enabled) {
    return NextResponse.json({ error: "Two factor sign in is already on." }, { status: 409 });
  }
  return NextResponse.json({ recoveryCodes: codes });
}
