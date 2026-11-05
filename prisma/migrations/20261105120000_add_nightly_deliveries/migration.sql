-- CreateTable
CREATE TABLE "NightlyDelivery" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tonight" BOOLEAN NOT NULL DEFAULT false,
    "dueTomorrow" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NightlyDelivery_pkey" PRIMARY KEY ("userId","day")
);

-- AddForeignKey
ALTER TABLE "NightlyDelivery" ADD CONSTRAINT "NightlyDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NightlyDelivery" ENABLE ROW LEVEL SECURITY;
