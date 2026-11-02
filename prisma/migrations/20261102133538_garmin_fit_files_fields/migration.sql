-- AlterTable
ALTER TABLE "fit_files" ADD COLUMN     "garminActivityId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'upload';

-- CreateIndex
CREATE UNIQUE INDEX "fit_files_userId_garminActivityId_key" ON "fit_files"("userId", "garminActivityId");

