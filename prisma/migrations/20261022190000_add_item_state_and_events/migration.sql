-- The state one student holds on one item; the tap events are separate rows so
-- the study can replay history from them even after a sync removes the
-- assignment itself.
CREATE TABLE "ItemState" (
    "userId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "skippedDay" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemState_pkey" PRIMARY KEY ("userId", "assignmentId")
);

CREATE TABLE "ItemEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "courseId" TEXT NOT NULL,
    "assignmentCanvasId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "shownRank" INTEGER,
    "listGeneratedAt" TIMESTAMP(3),
    "serverRank" INTEGER,
    "response" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemEvent_pkey" PRIMARY KEY ("id")
);

-- Retried taps with one idempotency key log once; taps without a key all get
-- NULL requestIds, and Postgres treats NULLs as distinct in unique indexes.
CREATE UNIQUE INDEX "ItemEvent_userId_requestId_key" ON "ItemEvent"("userId", "requestId");

CREATE INDEX "ItemEvent_userId_createdAt_idx" ON "ItemEvent"("userId", "createdAt");

ALTER TABLE "ItemState" ADD CONSTRAINT "ItemState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ItemState" ADD CONSTRAINT "ItemState_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ItemEvent" ADD CONSTRAINT "ItemEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The study data outlives the assignment: a sync that removes it nulls the
-- link but keeps courseId and assignmentCanvasId on the event.
ALTER TABLE "ItemEvent" ADD CONSTRAINT "ItemEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ItemState" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ItemEvent" ENABLE ROW LEVEL SECURITY;
