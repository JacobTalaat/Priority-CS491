import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function parseRequestBody(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { email, password } = body as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || typeof password !== "string") {
    return null;
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@") || password.length < 8) {
    return null;
  }
  return { email: normalizedEmail, password };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function POST(request: Request) {
  const credentials = await parseRequestBody(request);
  if (!credentials) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const existing = await prisma.user.findUnique({ where: { email: credentials.email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }
  try {
    const user = await prisma.user.create({
      data: { email: credentials.email, passwordHash: hashPassword(credentials.password) },
    });
    const { token, expiresAt } = await createSession(user.id);
    return NextResponse.json(
      { token, expiresAt, user: { id: user.id, email: user.email } },
      { status: 201 }
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }
    throw error;
  }
}
