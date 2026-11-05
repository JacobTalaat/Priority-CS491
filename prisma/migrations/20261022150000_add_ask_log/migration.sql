-- CreateTable
CREATE TABLE "AskLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "answer" TEXT,
    "found" BOOLEAN NOT NULL,
    "sourceCount" INTEGER NOT NULL,
    "courseId" TEXT,
    "sources" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AskLog_userId_createdAt_idx" ON "AskLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AskLog" ADD CONSTRAINT "AskLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AskLog" ENABLE ROW LEVEL SECURITY;
