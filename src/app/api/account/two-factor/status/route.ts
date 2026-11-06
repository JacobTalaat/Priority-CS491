import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Settings reads this once per visit: whether the flag is on, and how many
// unused recovery codes a layout still has to spare.
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }
  const [row, remaining] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true },
    }),
    prisma.recoveryCode.count({
      where: { userId: user.id, usedAt: null },
    }),
  ]);
  const enabled = row?.twoFactorEnabled ?? false;
  return NextResponse.json({
    enabled,
    recoveryCodesLeft: enabled ? remaining : 0,
  });
}
