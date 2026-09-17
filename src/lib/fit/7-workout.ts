// Шаг 7. Схема интервальной тренировки (--workout).
//
// На стадионе GPS врёт: отрезок 600 м часы пишут как 588 или 612 м, и темп
// выходит неверным. Если известна реальная длина отрезка, темп
// пересчитываем по ней: время круга / реальная дистанция.
//
// Три режима:
//   auto          — ищем схему сами (workout-detect.ts);
//   схема отрезков — "200 400 600x3": дистанции рабочих кругов 2, 4, 6…,
//                    между ними отдых, круг 1 — разминка;
//   полная разметка — чисел ровно столько, сколько кругов в файле
//                    (фартлек): дистанция задана для каждого круга.

import type { Lap, LapRole, WorkoutInfo } from "./types";
import { formatPace, round } from "./units";
import { detectWorkout, lapSpeed } from "./workout-detect";
import {
  DEFAULT_TOLERANCE_PCT,
  WorkoutPatternError,
  deviationPct,
  formatWorkoutTag,
} from "./workout-pattern";

export type WorkoutOption = "auto" | number[];

/** Если GPS расходится со схемой сильнее, скорее всего схема не та. */
const SUSPICIOUS_DEVIATION_PCT = 20;

export function applyWorkout(
  laps: Lap[],
  option: WorkoutOption | undefined,
  tolerancePct = DEFAULT_TOLERANCE_PCT,
): { laps: Lap[]; workout: WorkoutInfo | null } {
  if (option === undefined) return { laps, workout: null };
  if (option === "auto") return applyAuto(laps, tolerancePct);
  if (option.length === laps.length) return applyFullMarkup(laps, option);
  return applyActivePattern(laps, option);
}

// ─── Режимы ──────────────────────────────────────────────────────────────────

function applyAuto(laps: Lap[], tolerancePct: number) {
  const detected = detectWorkout(laps, tolerancePct);
  if (!detected.distancesM) {
    // Схему не нашли — круги не трогаем, только сообщаем почему.
    return {
      laps,
      workout: buildInfo("auto", laps, [], [], detected.warnings, tolerancePct),
    };
  }
  return applyDistances(laps, "auto", detected.activeIndexes, detected.distancesM, {
    warnings: detected.warnings,
    tolerancePct,
    withRoles: true,
  });
}

function applyActivePattern(laps: Lap[], distancesM: number[]) {
  // Рабочие круги — 2, 4, 6…: последнему нужен номер 2N.
  if (distancesM.length * 2 > laps.length) {
    throw new WorkoutPatternError(
      `В файле ${laps.length} кругов: укажите ${laps.length} дистанций (полная разметка) ` +
        `или не больше ${Math.floor(laps.length / 2)} рабочих отрезков`,
    );
  }
  const activeIndexes = distancesM.map((_, k) => 1 + 2 * k);
  const warnings = [
    ...slowerThanRestWarnings(laps, activeIndexes),
    ...deviationWarnings(laps, activeIndexes, distancesM),
  ];
  return applyDistances(laps, "manual", activeIndexes, distancesM, { warnings, withRoles: true });
}

function applyFullMarkup(laps: Lap[], distancesM: number[]) {
  const allIndexes = laps.map((_, i) => i);
  const warnings = deviationWarnings(laps, allIndexes, distancesM);
  return applyDistances(laps, "manual-full", allIndexes, distancesM, { warnings, withRoles: false });
}

// ─── Общая часть ─────────────────────────────────────────────────────────────

function applyDistances(
  laps: Lap[],
  source: WorkoutInfo["source"],
  adjustedIndexes: number[],
  distancesM: number[],
  { warnings, tolerancePct = null, withRoles }: {
    warnings: string[];
    tolerancePct?: number | null;
    withRoles: boolean;
  },
) {
  const roles = withRoles ? assignRoles(laps.length, adjustedIndexes) : null;
  const distanceByIndex = new Map(adjustedIndexes.map((lapIndex, k) => [lapIndex, distancesM[k]]));

  const adjusted = laps.map((lap, i) => {
    const withRole = { ...lap, role: roles?.[i] ?? null };
    const realDistance = distanceByIndex.get(i);
    return realDistance === undefined ? withRole : withRealDistance(withRole, realDistance);
  });

  return {
    laps: adjusted,
    workout: buildInfo(source, adjusted, adjustedIndexes, distancesM, warnings, tolerancePct),
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
 * Круг 1 — разминка, дальше рабочий / отдых по очереди.
 * После последнего рабочего: следующий круг — отдых, если за ним есть ещё
 * круги; всё остальное — заминка.
 */
function assignRoles(lapCount: number, activeIndexes: number[]): LapRole[] {
  const active = new Set(activeIndexes);
  const lastActive = activeIndexes.at(-1) ?? 0;

  return Array.from({ length: lapCount }, (_, i): LapRole => {
    if (i === 0) return "warmup";
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
  tolerancePct: number | null,
): WorkoutInfo {
  const adjusted = adjustedIndexes.map((i) => laps[i]);
  const distanceM = sum(adjusted.map((lap) => lap.distanceM));
  const durationSec = sum(adjusted.map((lap) => lap.durationSec));
  const paceSecPerKm = distanceM && durationSec ? round((durationSec / distanceM) * 1000, 1) : null;

  return {
    source,
    tag: distancesM.length ? formatWorkoutTag(distancesM) : null,
    tolerancePct,
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

/** Рабочий круг медленнее соседнего отдыха — похоже, схема сдвинута на круг. */
function slowerThanRestWarnings(laps: Lap[], activeIndexes: number[]): string[] {
  const active = new Set(activeIndexes);
  return activeIndexes.flatMap((i) => {
    const neighbours = [i - 1, i + 1].filter((j) => j >= 1 && j < laps.length && !active.has(j));
    const slower = neighbours.find((j) => lapSpeed(laps[i]) < lapSpeed(laps[j]));
    return slower === undefined
      ? []
      : [
          `Круг ${laps[i].index} (рабочий) медленнее круга ${laps[slower].index} (отдых) — ` +
            `возможно, схема сдвинута`,
        ];
  });
}

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
