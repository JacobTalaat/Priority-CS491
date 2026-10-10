-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canvasBaseUrl" TEXT,
ADD COLUMN     "canvasCheckedAt" TIMESTAMP(3),
ADD COLUMN     "canvasTokenCipher" TEXT,
ADD COLUMN     "canvasTokenIv" TEXT,
ADD COLUMN     "canvasTokenTag" TEXT;
