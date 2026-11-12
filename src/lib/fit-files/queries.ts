import "server-only";
import { db } from "@/lib/db";

/**
 * Все FIT-файлы пользователя, новые сверху — по дате самой тренировки
 * (workout.startTime), а не по дате загрузки: иначе подгруженная история
 * (кнопка «+10 тренировок») перемешала бы старые забеги с недавними.
 * Файлы без разбора (workout = null) не имеют даты тренировки — уходят вниз.
 *
 * Сортируем в JS, не в БД: Prisma не даёт задать `nulls: "last"` для поля
 * через связь (`workout.startTime` обязательное — модификатор принимает
 * только nullable-колонки), а список у одного пользователя небольшой —
 * личный лог тренировок, не тысячи строк.
 */
export const FIT_FILES_PAGE_SIZE = 10;

export async function listAllFitFiles(userId: string) {
  const files = await db.fitFile.findMany({
    where: { userId },
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

  return files.sort((a, b) => {
    const aTime = a.workout?.startTime.getTime() ?? -Infinity;
    const bTime = b.workout?.startTime.getTime() ?? -Infinity;
    return aTime !== bTime ? bTime - aTime : b.uploadedAt.getTime() - a.uploadedAt.getTime();
  });
}

/**
 * Страница списка (1-based). Листаем в JS, не в БД — та же причина, что и у
 * сортировки выше: порядок зависит от `workout.startTime` через связь.
 */
export async function listFitFiles(userId: string, page = 1) {
  const files = await listAllFitFiles(userId);
  const pageCount = Math.max(1, Math.ceil(files.length / FIT_FILES_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const start = (currentPage - 1) * FIT_FILES_PAGE_SIZE;

  return {
    files: files.slice(start, start + FIT_FILES_PAGE_SIZE),
    total: files.length,
    page: currentPage,
    pageCount,
  };
}

export type FitFileListItem = Awaited<ReturnType<typeof listAllFitFiles>>[number];

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
