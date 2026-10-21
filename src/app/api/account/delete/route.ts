import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { checkConfirmAllowed, clearFailedConfirms, recordFailedConfirm } from "@/lib/confirm-password-limit";
import { deleteAuthUser, verifyPassword } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  const { password } = body as { password?: unknown };
  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  const limit = checkConfirmAllowed(user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many password attempts." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { authUserId: true },
  });
  if (!row) {
    return unauthorized();
  }

  // The password check goes to Supabase Auth: re-authenticating is the proof
  // that it is really the student, and it keeps no password material of ours.
  const confirmed = await verifyPassword(user.email, password);
  if (!confirmed) {
    recordFailedConfirm(user.id);
    return NextResponse.json({ error: "Password is incorrect." }, { status: 403 });
  }

  clearFailedConfirms(user.id);
  // The auth user goes first: deleting it revokes the student's tokens, and if
  // the Prisma delete below fails the row is re-claimed by email on the next
  // log in instead of trapping the email forever.
  try {
    await deleteAuthUser(row.authUserId);
  } catch {
    return NextResponse.json(
      { error: "Could not delete your account right now. Try again." },
      { status: 500 }
    );
  }
  await prisma.user.delete({ where: { id: user.id } });
  return NextResponse.json({ deleted: true });
}
