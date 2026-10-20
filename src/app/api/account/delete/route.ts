import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { checkConfirmAllowed, clearFailedConfirms, recordFailedConfirm } from "@/lib/confirm-password-limit";
import { verifyPassword } from "@/lib/password";
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
    select: { passwordHash: true },
  });
  if (!row) {
    return unauthorized();
  }
  if (!verifyPassword(password, row.passwordHash)) {
    recordFailedConfirm(user.id);
    return NextResponse.json({ error: "Password is incorrect." }, { status: 403 });
  }

  clearFailedConfirms(user.id);
  await prisma.user.delete({ where: { id: user.id } });
  return NextResponse.json({ deleted: true });
}
