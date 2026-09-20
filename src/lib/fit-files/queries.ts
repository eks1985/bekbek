import "server-only";
import { db } from "@/lib/db";

/** Все FIT-файлы пользователя, новые сверху (индекс userId+uploadedAt). */
export function listFitFiles(userId: string) {
  return db.fitFile.findMany({
    where: { userId },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      originalName: true,
      sizeBytes: true,
      uploadedAt: true,
      // Дата и дистанция — из результата разбора по связи, без своих колонок.
      workout: {
        select: {
          startTime: true,
          distanceM: true,
          durationSec: true,
          avgPaceSecPerKm: true,
          workoutTag: true,
        },
      },
    },
  });
}

export type FitFileListItem = Awaited<ReturnType<typeof listFitFiles>>[number];

/**
 * Один файл с результатом разбора. userId в условии обязателен: иначе чужой
 * файл открылся бы по прямой ссылке (id угадать сложно, но полагаться на это
 * нельзя — проверка владельца, а не секретность ссылки).
 */
export function getFitFile(userId: string, id: string) {
  return db.fitFile.findFirst({
    where: { id, userId },
    include: { workout: true },
  });
}
