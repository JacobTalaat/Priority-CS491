import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAccessToken } from "@/lib/supabase";

function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function getUserFromRequest(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }
  const identity = await verifyAccessToken(token);
  if (!identity) {
    return null;
  }
  const existing = await prisma.user.findUnique({
    where: { authUserId: identity.authUserId },
  });
  if (existing) {
    // The token's verified email is what routes see, even when the row's copy
    // has gone stale (the student changed their email in Supabase).
    return { id: existing.id, email: identity.email };
  }
  try {
    const created = await prisma.user.create({
      data: { authUserId: identity.authUserId, email: identity.email },
    });
    return { id: created.id, email: created.email };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    // Two first logins raced with the same Supabase id: whichever create won,
    // its row is the one to hand back.
    const winner = await prisma.user.findUnique({
      where: { authUserId: identity.authUserId },
    });
    if (winner) {
      return { id: winner.id, email: identity.email };
    }
    // The conflict is on the email: another row holds it and no row belongs to
    // this Supabase account. That leaves the owner of the address unproven — a
    // signup with someone else's address succeeds until email confirmation is
    // on — so adopting that row could hand its Canvas token to the wrong
    // person. Fail closed: the request is unauthorized, and the row stays.
    console.error(
      "Refusing to reassign a user row to a Supabase account that does not already own it"
    );
    return null;
  }
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
