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
    return { id: existing.id, email: existing.email };
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
    // Two first logins raced, or a row from before Supabase already has this
    // email. Either way that row belongs to this Supabase account, since Auth
    // is the source of truth for the email.
    const winner = await prisma.user.findUnique({
      where: { authUserId: identity.authUserId },
    });
    if (winner) {
      return { id: winner.id, email: winner.email };
    }
    const claimed = await prisma.user.update({
      where: { email: identity.email },
      data: { authUserId: identity.authUserId },
    });
    return { id: claimed.id, email: claimed.email };
  }
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
