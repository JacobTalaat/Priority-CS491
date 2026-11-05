import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  const courses = await prisma.course.findMany({
    where: { userId: user.id, isCurrent: true },
    select: {
      id: true,
      name: true,
      courseCode: true,
      term: true,
      assignmentGroups: { select: { name: true, groupWeight: true }, orderBy: [{ position: "asc" }, { name: "asc" }] },
      assignments: {
        select: {
          id: true,
          title: true,
          assignmentGroup: { select: { name: true, groupWeight: true } },
        },
        orderBy: [{ title: "asc" }, { id: "asc" }],
      },
      gradeSetup: {
        select: {
          categories: true,
          assignmentMappings: true,
          finalExamWeight: true,
          cutoffs: true,
          classDetails: true,
          unsupportedRules: true,
          confirmedAt: true,
        },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ courses });
}
