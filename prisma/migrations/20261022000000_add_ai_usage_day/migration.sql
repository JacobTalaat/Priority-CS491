-- Postgres treats NULLs as distinct in unique constraints, so a missing userId
-- is stored as "" to keep the usage upsert reading and writing exactly one row.
CREATE TABLE "AiUsageDay" (
    "day" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "calls" BIGINT NOT NULL DEFAULT 0,
    "failedCalls" BIGINT NOT NULL DEFAULT 0,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageDay_pkey" PRIMARY KEY ("day", "feature", "userId"),
    CONSTRAINT "AiUsageDay_nonnegative" CHECK ("calls" >= 0 AND "failedCalls" >= 0 AND "inputTokens" >= 0 AND "outputTokens" >= 0 AND "costMicros" >= 0)
);

ALTER TABLE "AiUsageDay" ENABLE ROW LEVEL SECURITY;
