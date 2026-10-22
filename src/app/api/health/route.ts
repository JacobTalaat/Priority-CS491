import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { emailConfirmationRequired as readEmailConfirmationRequired } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
  // The email confirmation check is a release aid, not a readiness gate: it
  // itself answers null instead of throwing, and even an unexpected throw here
  // must not fail a route whose real question is "can I reach the database?".
  let emailConfirmationRequired = null;
  try {
    emailConfirmationRequired = await readEmailConfirmationRequired();
  } catch {
    // Already null; nothing else to do.
  }
  return NextResponse.json({ status: "ok", emailConfirmationRequired });
}
