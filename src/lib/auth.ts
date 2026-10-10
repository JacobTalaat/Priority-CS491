import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

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

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await prisma.session.create({
    data: { tokenHash, userId, expiresAt },
  });
  return { token, expiresAt };
}

export async function getSessionFromRequest(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return session;
}

export async function getUserFromRequest(request: Request) {
  const session = await getSessionFromRequest(request);
  return session?.user ?? null;
}

export async function rotateSession(
  sessionId: string,
  userId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await prisma.$transaction([
    prisma.session.delete({ where: { id: sessionId } }),
    prisma.session.create({ data: { tokenHash, userId, expiresAt } }),
  ]);
  return { token, expiresAt };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } });
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
