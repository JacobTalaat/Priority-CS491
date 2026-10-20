import { prisma } from "@/lib/prisma";

const MICROS_PER_MILLION = BigInt(1000000);

export function spendPeriod(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function costMicros(
  inputTokens: number,
  outputTokens: number,
  inputMicrosPerMillion: number,
  outputMicrosPerMillion: number
): number {
  return microsForTokens(inputTokens, inputMicrosPerMillion) + microsForTokens(outputTokens, outputMicrosPerMillion);
}

function microsForTokens(tokens: number, microsPerMillion: number): number {
  const product = BigInt(tokens) * BigInt(microsPerMillion);
  const million = MICROS_PER_MILLION;
  return Number((product + million - BigInt(1)) / million);
}

export function estimateInputTokens(messages: readonly { role: string; content: string }[]): number {
  let bytes = 64;
  for (const message of messages) {
    bytes += Buffer.byteLength(message.content, "utf8") + 16;
  }
  return bytes;
}

export async function reserveSpend({
  period,
  reserveMicros,
  capMicros,
}: {
  period: string;
  reserveMicros: number;
  capMicros: number;
}): Promise<boolean> {
  const reserve = BigInt(reserveMicros);
  const cap = BigInt(capMicros);
  const rows = (await prisma.$queryRaw`
    WITH reserved AS (
      INSERT INTO "AiSpendMonth" ("period", "spentMicros", "reservedMicros", "updatedAt")
      SELECT ${period}::text, 0, ${reserve}::bigint, now()
      WHERE ${reserve}::bigint <= ${cap}::bigint
      ON CONFLICT ("period") DO UPDATE
      SET "reservedMicros" = "AiSpendMonth"."reservedMicros" + EXCLUDED."reservedMicros",
          "updatedAt" = now()
      WHERE "AiSpendMonth"."spentMicros" + "AiSpendMonth"."reservedMicros" + EXCLUDED."reservedMicros" <= ${cap}::bigint
      RETURNING "period"
    )
    SELECT "period" FROM reserved
  `) as unknown as readonly unknown[];
  return rows.length === 1;
}

export async function settleSpend({
  period,
  reserveMicros,
  costMicros: cost,
}: {
  period: string;
  reserveMicros: number;
  costMicros: number;
}): Promise<void> {
  const reserve = BigInt(reserveMicros);
  const affected = (await prisma.$executeRaw`
    UPDATE "AiSpendMonth"
    SET "reservedMicros" = "reservedMicros" - ${reserve}::bigint,
        "spentMicros" = "spentMicros" + ${BigInt(cost)}::bigint,
        "updatedAt" = now()
    WHERE "period" = ${period}::text
  `) as unknown as number;
  if (affected !== 1) {
    throw new Error("AI spend settlement updated no row");
  }
}
