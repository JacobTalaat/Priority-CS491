import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { CanvasError, getCanvasProfile } from "@/lib/canvas";
import { getCanvasToken, saveCanvasToken } from "@/lib/canvas-credentials";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  try {
    const credentials = await getCanvasToken(user.id);
    if (!credentials) {
      return NextResponse.json({ error: "Canvas not connected" }, { status: 409 });
    }
    const canvasUser = await getCanvasProfile(credentials.baseUrl, credentials.token);
    await saveCanvasToken(user.id, credentials.baseUrl, credentials.token);
    return NextResponse.json({ ok: true, canvasUser });
  } catch (error) {
    if (error instanceof CanvasError && error.kind === "unauthorized") {
      return NextResponse.json({ error: "Canvas rejected this token" }, { status: 400 });
    }
    if (error instanceof CanvasError && error.kind === "network") {
      return NextResponse.json({ error: "Could not reach Canvas" }, { status: 502 });
    }
    if (error instanceof CanvasError) {
      return NextResponse.json({ error: "Canvas request failed" }, { status: 502 });
    }
    return NextResponse.json({ error: "Token check failed" }, { status: 500 });
  }
}
