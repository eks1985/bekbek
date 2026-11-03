import "server-only";
import { db } from "@/lib/db";
import { saveFitBytes } from "@/lib/fit-files/upload";
import { downloadGarminFit, listGarminActivities, triggerGarminSync } from "./client";

export type GarminImportSummary = {
  imported: number;
  skipped: number;
  errors: number;
  /** Кандидатов было больше, чем взяли за этот вызов — стоит вызвать ещё раз. */
  more: boolean;
};

// Серверная функция bek-bek — serverless, лимит по времени на один вызов,
// поэтому тащим не больше нескольких файлов за раз (клиент повторяет вызов,
// пока more: true).
const IMPORT_LIMIT_PER_CALL = 5;

/**
 * Подтягивает в bek-bek новые тренировки из Garmin для одного пользователя.
 * Источник истины для дедупликации — сам bek-bek: берём все activity_id,
 * уже привязанные к файлам пользователя, и качаем только недостающие.
 */
export async function syncFromGarmin(userId: string): Promise<GarminImportSummary> {
  // Лучшее усилие: даже если сервис троттлит или недоступен, всё равно
  // смотрим, что уже лежит на VPS по прошлым синкам.
  await triggerGarminSync(userId).catch((err) => {
    console.error("garmin-sync /sync недоступен, продолжаем по тому, что уже скачано", err);
  });

  const activities = await listGarminActivities(userId);

  const known = await db.fitFile.findMany({
    where: { userId, garminActivityId: { not: null } },
    select: { garminActivityId: true },
  });
  const knownIds = new Set(known.map((r) => r.garminActivityId));

  const candidates = activities.filter(
    (a) => a.status === "downloaded" && !knownIds.has(String(a.activity_id)),
  );
  const batch = candidates.slice(0, IMPORT_LIMIT_PER_CALL);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const activity of batch) {
    try {
      const bytes = await downloadGarminFit(userId, activity.activity_id);
      const result = await saveFitBytes(userId, bytes, `${activity.activity_id}.fit`, {
        source: "garmin",
        garminActivityId: String(activity.activity_id),
      });
      if (result.ok) {
        imported++;
      } else if (result.status === 409) {
        // Тот же файл уже есть (в т.ч. могли привязать garminActivityId выше).
        skipped++;
      } else {
        errors++;
      }
    } catch (err) {
      console.error(`Импорт активности ${activity.activity_id} из Garmin не удался:`, err);
      errors++;
    }
  }

  return { imported, skipped, errors, more: candidates.length > batch.length };
}
