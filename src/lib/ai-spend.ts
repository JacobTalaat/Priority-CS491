import { prisma } from "@/lib/prisma";

const MICROS_PER_MILLION = BigInt(1000000);

// Fraction of the monthly cap above which the server log gets one warning.
const SPEND_WARNING_THRESHOLD_PERCENT = 80;

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

// Claims the right to emit the near-cap warning for a period: the conditional
// update lets exactly one concurrent caller or server win, so the warning is
// sent once per month even across restarts. Returns the month's spend when the
// claim was won, null when the warning was already sent or usage is not over
// the threshold yet. A forced claim drops the threshold (spent+reserved >= 0
// always holds) for the refusal path, where the cap is already reached.
export async function claimSpendWarning({
  period,
  capMicros,
  force = false,
}: {
  period: string;
  capMicros: number;
  force?: boolean;
}): Promise<{ spentMicros: bigint; reservedMicros: bigint } | null> {
  const cap = BigInt(capMicros);
  const threshold = (cap * BigInt(SPEND_WARNING_THRESHOLD_PERCENT)) / BigInt(100);
  const rows = (await prisma.$queryRaw`
    UPDATE "AiSpendMonth"
    SET "warnedAt" = now()
    WHERE "period" = ${period}::text
      AND "warnedAt" IS NULL
      AND "spentMicros" + "reservedMicros" >= ${force ? BigInt(0) : threshold}::bigint
    RETURNING "spentMicros", "reservedMicros"
  `) as unknown as readonly unknown[];
  const row = rows[0];
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const claimed = row as { spentMicros: unknown; reservedMicros: unknown };
  if (typeof claimed.spentMicros !== "bigint" || typeof claimed.reservedMicros !== "bigint") {
    return null;
  }
  return { spentMicros: claimed.spentMicros, reservedMicros: claimed.reservedMicros };
}
