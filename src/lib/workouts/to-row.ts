// Результат парсинга → поля строки таблицы workouts.
// Колонки для фильтров копируются из summary, весь результат (без точек) — в data.
import type { Prisma } from "@prisma/client";
import type { ParsedWorkout } from "@/lib/fit";

/** Увеличивать, когда меняется формат data: по нему видно, какие записи переразобрать. */
export const PARSER_VERSION = 1;

export function workoutRow(parsed: ParsedWorkout) {
  const { summary: s } = parsed;
  if (!s.startTime) {
    throw new Error("В файле нет времени старта тренировки — сохранить нельзя");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { points, ...data } = parsed;

  return {
    startTime: new Date(s.startTime),
    sport: s.sport,
    distanceM: s.distanceM,
    durationSec: s.durationSec,
    avgPaceSecPerKm: s.avgPaceSecPerKm,
    avgHeartRate: s.avgHeartRate === null ? null : Math.round(s.avgHeartRate),
    workoutTag: s.workoutTag,
    data: data as unknown as Prisma.InputJsonValue,
    parserVersion: PARSER_VERSION,
  };
}
