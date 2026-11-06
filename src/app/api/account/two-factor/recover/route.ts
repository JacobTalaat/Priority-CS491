import { NextResponse } from "next/server";
import { authenticateRequest, unauthorized } from "@/lib/auth";
import { clearFailedConfirms, checkConfirmAllowed, recordFailedConfirm } from "@/lib/confirm-password-limit";
import { deleteAllTotpFactors } from "@/lib/supabase";
import { recoveryCodeHashFromRaw } from "@/lib/two-factor-codes";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const WRONG_CODE = "That recovery code is not right.";

// The one route a student may call with only the password token: they have
// lost their authenticator app and answer with a recovery code instead.
// A valid code is proof enough, and the whole setup is torn down so they can
// set two factor up again once they are in.
export async function POST(request: Request) {
  const outcome = await authenticateRequest(request, { allowSingleFactor: true });
  if (!outcome.user) {
    return unauthorized();
  }
  const user = outcome.user;

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
  if (typeof code !== "string" || code.length === 0) {
    return NextResponse.json({ error: WRONG_CODE }, { status: 400 });
  }

  const limit = checkConfirmAllowed(user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many recovery code attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const codeHash = recoveryCodeHashFromRaw(code);
  if (!codeHash) {
    recordFailedConfirm(user.id);
    return NextResponse.json({ error: WRONG_CODE }, { status: 400 });
  }

  // First locked read: the code only gets a chance at all while two factor is
  // on and the code is stored and still unused. Codes left over from an
  // earlier setup, or any code while the flag is off, cannot act.
  const usable = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
    const row = await tx.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true },
    });
    if (row === null || !row.twoFactorEnabled) {
      return false;
    }
    const stored = await tx.recoveryCode.findFirst({
      where: { userId: user.id, codeHash, usedAt: null },
      select: { id: true },
    });
    return stored !== null;
  });
  if (!usable) {
    recordFailedConfirm(user.id);
    return NextResponse.json({ error: WRONG_CODE }, { status: 400 });
  }

  try {
    await deleteAllTotpFactors(outcome.authUserId);
  } catch {
    // Nothing has been consumed so far, so this exact code still works for a
    // retry; two factor is not off yet and no database state moved.
    return NextResponse.json(
      { error: "Two factor could not be turned off right now. Try again shortly." },
      { status: 500 }
    );
  }

  // Second locked write: one code, at most ever, plus the state tear-down in
  // the very same transaction. Losing a race here to a concurrent disable or
  // recover answers as if the code had been wrong — nothing else moved.
  const cleared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
    const row = await tx.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true },
    });
    if (row === null || !row.twoFactorEnabled) {
      return false;
    }
    const claimed = await tx.recoveryCode.updateMany({
      where: { userId: user.id, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      return false;
    }
    await tx.user.updateMany({ where: { id: user.id }, data: { twoFactorEnabled: false } });
    await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
    return true;
  });
  if (!cleared) {
    recordFailedConfirm(user.id);
    return NextResponse.json({ error: WRONG_CODE }, { status: 400 });
  }
  clearFailedConfirms(user.id);

  // Two factor is now off, so the still password-only token opens the app.
  return NextResponse.json({ recovered: true });
}
