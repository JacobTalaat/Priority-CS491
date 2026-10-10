import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { getCanvasStatus } from "@/lib/canvas-credentials";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const status = await getCanvasStatus(user.id);
  if (!status.connected) {
    return NextResponse.json({ connected: false, courses: [] });
  }

  const courses = await prisma.course.findMany({
    where: { userId: user.id, isCurrent: true },
    select: { id: true, name: true, courseCode: true, term: true, termEndsAt: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ connected: true, courses });
}
