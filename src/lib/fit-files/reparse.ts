import "server-only";
import { FitParseError, WorkoutPatternError, parseWorkout, parseWorkoutPattern } from "@/lib/fit";
import type { WorkoutOption } from "@/lib/fit";
import { db } from "@/lib/db";
import { workoutRow } from "@/lib/workouts/to-row";
import { getObject } from "@/lib/storage/s3";

export type ReparseOptions = {
  /** Своя схема; непустая строка отменяет режим auto. */
  pattern?: string;
  tolerancePct?: number;
  warmupLaps?: number;
};

export type ReparseResult =
  | {
      ok: true;
      workout: { workoutTag: string | null; startTime: Date; distanceM: number | null };
    }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Разбирает уже загруженный файл заново: исходник берём из бакета, результат
 * перезаписываем в workouts. Upsert, а не update: записи может не быть вовсе —
 * файл мог быть загружен до появления разбора или разбор тогда не удался.
 */
export async function reparseFitFile(
  userId: string,
  fitFileId: string,
  { pattern, tolerancePct, warmupLaps }: ReparseOptions,
): Promise<ReparseResult> {
  // userId в условии — чужой файл не перебрать даже по прямой ссылке.
  const file = await db.fitFile.findFirst({
    where: { id: fitFileId, userId },
    select: { id: true, storageKey: true, originalName: true },
  });
  if (!file) return { ok: false, status: 404, error: "Файл не найден" };

  const manual = pattern?.trim() ? pattern.trim() : null;
  let workoutOption: WorkoutOption;
  try {
    workoutOption = manual === null ? "auto" : parseWorkoutPattern(manual);
  } catch (err) {
    if (err instanceof WorkoutPatternError) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }

  const bytes = await getObject(file.storageKey);

  let row: ReturnType<typeof workoutRow>;
  try {
    row = workoutRow(
      parseWorkout(bytes, {
        fileName: file.originalName,
        workout: workoutOption,
        // При своей схеме допуск и разминка не применяются: схема жёсткая.
        ...(manual === null ? { tolerancePct, warmupLaps } : {}),
      }),
    );
  } catch (err) {
    // Тексты этих ошибок писались для человека — их и показываем.
    if (err instanceof WorkoutPatternError || err instanceof FitParseError) {
      return { ok: false, status: 400, error: err.message };
    }
    if (err instanceof Error && err.message.includes("времени старта")) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }

  const workout = await db.workout.upsert({
    where: { fitFileId: file.id },
    create: { userId, fitFileId: file.id, ...row },
    update: row,
    select: { workoutTag: true, startTime: true, distanceM: true },
  });

  return { ok: true, workout };
}
