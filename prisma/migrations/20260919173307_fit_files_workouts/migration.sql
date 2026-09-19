-- CreateTable
CREATE TABLE "fit_files" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fit_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workouts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fitFileId" TEXT NOT NULL,
    "title" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "sport" TEXT,
    "distanceM" DOUBLE PRECISION,
    "durationSec" DOUBLE PRECISION,
    "avgPaceSecPerKm" DOUBLE PRECISION,
    "avgHeartRate" INTEGER,
    "workoutTag" TEXT,
    "data" JSONB NOT NULL,
    "parserVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fit_files_storageKey_key" ON "fit_files"("storageKey");

-- CreateIndex
CREATE INDEX "fit_files_userId_uploadedAt_idx" ON "fit_files"("userId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "fit_files_userId_sha256_key" ON "fit_files"("userId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "workouts_fitFileId_key" ON "workouts"("fitFileId");

-- CreateIndex
CREATE INDEX "workouts_userId_startTime_idx" ON "workouts"("userId", "startTime");

-- CreateIndex
CREATE INDEX "workouts_userId_workoutTag_idx" ON "workouts"("userId", "workoutTag");

-- CreateIndex
CREATE INDEX "workouts_userId_distanceM_idx" ON "workouts"("userId", "distanceM");

-- AddForeignKey
ALTER TABLE "fit_files" ADD CONSTRAINT "fit_files_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_fitFileId_fkey" FOREIGN KEY ("fitFileId") REFERENCES "fit_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
