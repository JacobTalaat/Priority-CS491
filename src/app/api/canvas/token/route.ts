import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { normalizeCanvasBaseUrl, getCanvasProfile, CanvasError } from "@/lib/canvas";
import { clearCanvasToken, getCanvasStatus, saveCanvasToken } from "@/lib/canvas-credentials";
import { env } from "@/lib/env";

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
  const { token, baseUrl } = body as { token?: unknown; baseUrl?: unknown };
  if (typeof token !== "string" || token.trim().length === 0) {
    return null;
  }
  if (baseUrl !== undefined && typeof baseUrl !== "string") {
    return null;
  }
  return { token: token.trim(), baseUrl };
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  const body = await parseRequestBody(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  let baseUrl: string;
  try {
    baseUrl = normalizeCanvasBaseUrl(body.baseUrl === undefined ? env.canvasBaseUrl : body.baseUrl);
  } catch {
    return NextResponse.json({ error: "Invalid Canvas URL" }, { status: 400 });
  }
  let canvasUser: { id: number; name: string };
  try {
    canvasUser = await getCanvasProfile(baseUrl, body.token);
  } catch (error) {
    if (error instanceof CanvasError && error.kind === "unauthorized") {
      return NextResponse.json({ error: "Canvas rejected this token" }, { status: 400 });
    }
    if (error instanceof CanvasError && error.kind === "network") {
      return NextResponse.json({ error: "Could not reach Canvas" }, { status: 502 });
    }
    return NextResponse.json({ error: "Canvas request failed" }, { status: 502 });
  }
  await saveCanvasToken(user.id, baseUrl, body.token);
  return NextResponse.json({ connected: true, canvasUser });
}

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  const status = await getCanvasStatus(user.id);
  return NextResponse.json({
    connected: status.connected,
    baseUrl: status.baseUrl,
    checkedAt: status.checkedAt,
  });
}

export async function DELETE(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  await clearCanvasToken(user.id);
  return NextResponse.json({ connected: false });
}
