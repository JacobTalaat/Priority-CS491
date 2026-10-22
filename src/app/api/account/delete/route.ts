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

  // The password check goes to Supabase Auth with the email the token itself
  // carries, so a student who changes their email in Supabase can still delete
  // their account. It is the proof that it is really them, and it keeps no
  // password material of ours.
  const confirmed = await verifyPassword(user.email, password);
  if (!confirmed) {
    recordFailedConfirm(user.id);
    return NextResponse.json({ error: "Password is incorrect." }, { status: 403 });
  }

  clearFailedConfirms(user.id);
  // The Prisma row goes first: it takes the student's data with it. If the
  // Supabase delete below then fails, nothing sensitive is left sitting behind
  // an email that is free to register again — the next sign-in recreates an
  // empty row, and the student can retry the deletion.
  try {
    await prisma.user.delete({ where: { id: user.id } });
  } catch {
    return NextResponse.json(
      { error: "Could not delete your account. Try again." },
      { status: 500 }
    );
  }
  try {
    await deleteAuthUser(row.authUserId);
  } catch {
    // The data is already gone and cannot come back, but the login itself is
    // still there, which keeps the email from being taken over; deleting it is
    // what frees it up again.
    return NextResponse.json(
      { error: "Your data was deleted, but your account is still there. Try again." },
      { status: 500 }
    );
  }
  return NextResponse.json({ deleted: true });
}
