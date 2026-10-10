import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { CanvasError } from "@/lib/canvas";
import { syncUser } from "@/lib/import/sync";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  try {
    const result = await syncUser(user.id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Canvas not connected") {
      return NextResponse.json({ error: "Canvas not connected" }, { status: 409 });
    }
    if (error instanceof CanvasError && error.kind === "unauthorized") {
      return NextResponse.json({ error: "Canvas rejected this token" }, { status: 400 });
    }
    if (error instanceof CanvasError && error.kind === "network") {
      return NextResponse.json({ error: "Could not reach Canvas" }, { status: 502 });
    }
    if (error instanceof CanvasError) {
      return NextResponse.json({ error: "Canvas request failed" }, { status: 502 });
    }
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { lastSyncedAt: true },
  });
  return NextResponse.json({ lastSyncedAt: dbUser?.lastSyncedAt ?? null });
}
