CREATE TABLE "AiSpendMonth" (
    "period" TEXT NOT NULL,
    "spentMicros" BIGINT NOT NULL DEFAULT 0,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSpendMonth_pkey" PRIMARY KEY ("period"),
    CONSTRAINT "AiSpendMonth_nonnegative" CHECK ("spentMicros" >= 0 AND "reservedMicros" >= 0)
);

ALTER TABLE "AiSpendMonth" ENABLE ROW LEVEL SECURITY;
