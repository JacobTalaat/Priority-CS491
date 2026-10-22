import { prisma } from "@/lib/prisma";

export type AiUsageTotals = {
  day: string;
  feature: string;
  calls: bigint;
  failedCalls: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
  costMicros: bigint;
};

// UTC days so the buckets line up with the UTC spend periods.
export function aiUsageDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// calls counts every provider call; failedCalls the failed subset of those.

export async function recordAiUsage({
  day,
  feature,
  userId,
  failed,
  inputTokens,
  outputTokens,
  costMicros: cost,
}: {
  day: string;
  feature: string;
  userId: string | null;
  failed: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number;
}): Promise<void> {
  const userKey = userId ?? "";
  const failedInc = failed ? BigInt(1) : BigInt(0);
  await prisma.$queryRaw`
    INSERT INTO "AiUsageDay"
      ("day", "feature", "userId", "calls", "failedCalls", "inputTokens", "outputTokens", "costMicros", "updatedAt")
    VALUES (
      ${day}::text, ${feature}::text, ${userKey}::text,
      ${BigInt(1)}::bigint, ${failedInc}::bigint,
      ${inputTokens === null ? BigInt(0) : BigInt(inputTokens)}::bigint,
      ${outputTokens === null ? BigInt(0) : BigInt(outputTokens)}::bigint,
      ${BigInt(cost)}::bigint,
      now()
    )
    ON CONFLICT ("day", "feature", "userId") DO UPDATE
    SET "calls" = "AiUsageDay"."calls" + EXCLUDED."calls",
        "failedCalls" = "AiUsageDay"."failedCalls" + EXCLUDED."failedCalls",
        "inputTokens" = "AiUsageDay"."inputTokens" + EXCLUDED."inputTokens",
        "outputTokens" = "AiUsageDay"."outputTokens" + EXCLUDED."outputTokens",
        "costMicros" = "AiUsageDay"."costMicros" + EXCLUDED."costMicros",
        "updatedAt" = now()
  `;
}

export async function getAiUsage({
  from,
  to,
}: {
  from: string;
  to: string;
}): Promise<AiUsageTotals[]> {
  const rows = await prisma.aiUsageDay.groupBy({
    by: ["day", "feature"],
    where: {
      day: { gte: from, lte: to },
    },
    _sum: {
      calls: true,
      failedCalls: true,
      inputTokens: true,
      outputTokens: true,
      costMicros: true,
    },
    orderBy: [{ day: "asc" }, { feature: "asc" }],
  });
  return rows.map((row) => ({
    day: row.day,
    feature: row.feature,
    calls: row._sum.calls ?? BigInt(0),
    failedCalls: row._sum.failedCalls ?? BigInt(0),
    inputTokens: row._sum.inputTokens ?? BigInt(0),
    outputTokens: row._sum.outputTokens ?? BigInt(0),
    costMicros: row._sum.costMicros ?? BigInt(0),
  }));
}
