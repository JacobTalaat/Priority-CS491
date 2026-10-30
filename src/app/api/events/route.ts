import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Event names are short machine identifiers like "sync_now" or "today.mark_done", so no
// free text (and no personal data) can end up in the table.
const EVENT_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const MAX_EVENT_LENGTH = 64;
const CLIENTS = ["web", "app"] as const;
type Client = (typeof CLIENTS)[number];

async function parseRequestBody(request: Request): Promise<{ event: string; client: Client } | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  // Reject anything beyond the two known fields so clients can't attach extra data.
  if (Object.keys(body).some((key) => key !== "event" && key !== "client")) {
    return null;
  }
  const { event, client } = body as { event?: unknown; client?: unknown };
  if (typeof event !== "string" || event.length > MAX_EVENT_LENGTH || !EVENT_PATTERN.test(event)) {
    return null;
  }
  if (typeof client !== "string" || !CLIENTS.includes(client as Client)) {
    return null;
  }
  return { event, client: client as Client };
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
  await prisma.usageEvent.create({
    data: { userId: user.id, event: body.event, client: body.client },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
