// Шаг 7. Схема интервальной тренировки (--workout).
//
// На стадионе GPS врёт: отрезок 600 м часы пишут как 588 или 612 м, и темп
// выходит неверным. Если известна реальная длина отрезка, темп
// пересчитываем по ней: время круга / реальная дистанция.
//
// Два режима:
//   auto   — ищем схему сами (workout-detect.ts); первые warmupLaps кругов
//            (по умолчанию 1) — разминка;
//   manual — схема от пользователя: значений ровно столько, сколько кругов
//            в файле. Число — рабочий отрезок, "-" — нерабочий круг
//            (разминка, отдых, заминка), у него остаётся дистанция из файла.

import type { Lap, LapRole, WorkoutInfo } from "./types";
import { formatPace, round } from "./units";
import { detectWorkout } from "./workout-detect";
import {
  DEFAULT_TOLERANCE_PCT,
  WorkoutPatternError,
  deviationPct,
  formatWorkoutTag,
  type WorkoutPatternItem,
} from "./workout-pattern";

export type WorkoutOption = "auto" | WorkoutPatternItem[];

/** Настройки режима auto; в ручных режимах не используются. */
export interface AutoOptions {
  /** Допуск округления до целой дистанции, %. */
  tolerancePct?: number;
  /** Сколько первых кругов — разминка; схема ищется с круга warmupLaps + 1. */
  warmupLaps?: number;
}

type ResolvedAutoOptions = Required<AutoOptions>;

/** По умолчанию разминка — один первый круг. */
export const DEFAULT_WARMUP_LAPS = 1;

/** Если GPS расходится со схемой сильнее, скорее всего схема не та. */
const SUSPICIOUS_DEVIATION_PCT = 20;

export function applyWorkout(
  laps: Lap[],
  option: WorkoutOption | undefined,
  { tolerancePct = DEFAULT_TOLERANCE_PCT, warmupLaps = DEFAULT_WARMUP_LAPS }: AutoOptions = {},
): { laps: Lap[]; workout: WorkoutInfo | null } {
  if (option === undefined) return { laps, workout: null };
  if (option === "auto") return applyAuto(laps, { tolerancePct, warmupLaps });
  if (option.length !== laps.length) {
    throw new WorkoutPatternError(
      `В схеме ${option.length} значений, а кругов в файле ${laps.length}: ` +
        `нужно значение на каждый круг («-» — нерабочий)`,
    );
  }
  return applyManual(laps, option);
}

// ─── Режимы ──────────────────────────────────────────────────────────────────

function applyAuto(laps: Lap[], auto: ResolvedAutoOptions) {
  const detected = detectWorkout(laps, auto.tolerancePct, auto.warmupLaps);
  if (!detected.distancesM) {
    // Схему не нашли — круги не трогаем, только сообщаем почему.
    return {
      laps,
      workout: buildInfo("auto", laps, [], [], detected.warnings, auto),
    };
  }
  return applyDistances(laps, "auto", detected.activeIndexes, detected.distancesM, {
    warnings: detected.warnings,
    auto,
    withRoles: true,
  });
}

function applyManual(laps: Lap[], items: WorkoutPatternItem[]) {
  // У кругов с "-" остаются дистанция и темп из файла; в итогах схемы они
  // не участвуют, но в теге видны дефисом.
  const indexes = items.flatMap((item, i) => (item === null ? [] : [i]));
  const distancesM = indexes.map((i) => items[i] as number);
  const warnings = deviationWarnings(laps, indexes, distancesM);
  if (indexes.length === 0) {
    warnings.push("Во всех кругах стоит «-» — пересчитывать нечего");
  }
  return applyDistances(laps, "manual", indexes, distancesM, { warnings, withRoles: false });
}

// ─── Общая часть ─────────────────────────────────────────────────────────────

function applyDistances(
  laps: Lap[],
  source: WorkoutInfo["source"],
  adjustedIndexes: number[],
  distancesM: number[],
  { warnings, auto = null, withRoles }: {
    warnings: string[];
    auto?: ResolvedAutoOptions | null;
    withRoles: boolean;
  },
) {
  // Разминка в ручной схеме — всегда первый круг; в auto — сколько задано.
  const warmupLaps = auto?.warmupLaps ?? DEFAULT_WARMUP_LAPS;
  const roles = withRoles ? assignRoles(laps.length, adjustedIndexes, warmupLaps) : null;
  const distanceByIndex = new Map(adjustedIndexes.map((lapIndex, k) => [lapIndex, distancesM[k]]));

  const adjusted = laps.map((lap, i) => {
    const withRole = { ...lap, role: roles?.[i] ?? null };
    const realDistance = distanceByIndex.get(i);
    return realDistance === undefined ? withRole : withRealDistance(withRole, realDistance);
  });

  return {
    laps: adjusted,
    workout: buildInfo(source, adjusted, adjustedIndexes, distancesM, warnings, auto),
  };
}

/** Подменяет дистанцию и темп круга реальными, значения GPS сохраняет рядом. */
function withRealDistance(lap: Lap, distanceM: number): Lap {
  const paceSecPerKm = lap.durationSec ? round((lap.durationSec / distanceM) * 1000, 1) : null;
  return {
    ...lap,
    distanceM,
    avgSpeedMps: lap.durationSec ? round(distanceM / lap.durationSec, 3) : null,
    avgPaceSecPerKm: paceSecPerKm,
    avgPace: formatPace(paceSecPerKm),
    gpsDistanceM: lap.distanceM,
    gpsAvgPaceSecPerKm: lap.avgPaceSecPerKm,
    gpsAvgPace: lap.avgPace,
  };
}

/**
 * Первые warmupLaps кругов — разминка, дальше рабочий / отдых по очереди.
 * После последнего рабочего: следующий круг — отдых, если за ним есть ещё
 * круги; всё остальное — заминка.
 */
function assignRoles(lapCount: number, activeIndexes: number[], warmupLaps: number): LapRole[] {
  const active = new Set(activeIndexes);
  const lastActive = activeIndexes.at(-1) ?? 0;

  return Array.from({ length: lapCount }, (_, i): LapRole => {
    if (i < warmupLaps) return "warmup";
    if (i <= lastActive) return active.has(i) ? "active" : "rest";
    if (i === lastActive + 1 && i < lapCount - 1) return "rest";
    return "cooldown";
  });
}

function buildInfo(
  source: WorkoutInfo["source"],
  laps: Lap[],
  adjustedIndexes: number[],
  distancesM: number[],
  warnings: string[],
  auto: ResolvedAutoOptions | null,
): WorkoutInfo {
  const adjusted = adjustedIndexes.map((i) => laps[i]);
  const distanceM = sum(adjusted.map((lap) => lap.distanceM));
  const durationSec = sum(adjusted.map((lap) => lap.durationSec));
  const paceSecPerKm = distanceM && durationSec ? round((durationSec / distanceM) * 1000, 1) : null;

  // Тег — ряд по всем кругам: дистанция у рабочих, дефис у остальных.
  const distanceByIndex = new Map(adjustedIndexes.map((lapIndex, k) => [lapIndex, distancesM[k]]));
  const tagItems = laps.map((_, i) => distanceByIndex.get(i) ?? null);

  return {
    source,
    tag: distancesM.length ? formatWorkoutTag(tagItems) : null,
    tolerancePct: auto?.tolerancePct ?? null,
    warmupLaps: auto?.warmupLaps ?? null,
    distancesM,
    adjustedLapIndexes: adjusted.map((lap) => lap.index),
    adjustedDistanceM: distanceM === null ? null : round(distanceM, 2),
    adjustedDurationSec: durationSec === null ? null : round(durationSec, 1),
    adjustedAvgPaceSecPerKm: paceSecPerKm,
    adjustedAvgPace: formatPace(paceSecPerKm),
    warnings,
  };
}

// ─── Проверки ручной схемы ───────────────────────────────────────────────────

/** GPS сильно расходится с заданной дистанцией. */
function deviationWarnings(laps: Lap[], indexes: number[], distancesM: number[]): string[] {
  return indexes.flatMap((i, k) => {
    const gps = laps[i].distanceM;
    if (gps === null) return [];
    const deviation = deviationPct(gps, distancesM[k]);
    return deviation > SUSPICIOUS_DEVIATION_PCT
      ? [
          `Круг ${laps[i].index}: по GPS ${Math.round(gps)} м, в схеме ${distancesM[k]} м ` +
            `(расхождение ${Math.round(deviation)}%)`,
        ]
      : [];
  });
}

function sum(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((total, v) => total + v, 0);
}
