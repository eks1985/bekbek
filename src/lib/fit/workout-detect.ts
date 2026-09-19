// Автопоиск схемы интервалов по кругам (--workout auto).
//
// Идея:
//   1. Первые warmupLaps кругов (по умолчанию 1) — разминка, смотрим круги
//      после неё.
//   2. Делим эти круги на «быстрые» и «медленные» по средней скорости:
//      ищем порог, при котором обе группы внутри максимально однородны.
//   3. С первого круга после разминки должно идти строгое чередование:
//      быстрый, медленный, быстрый… Первое нарушение — конец схемы, дальше заминка.
//   4. Каждый быстрый круг округляем до «целой» дистанции с допуском.

import type { Lap } from "./types";
import { matchRoundDistance } from "./workout-pattern";

/** Быстрая группа должна быть хотя бы на 20 % быстрее медленной. */
const MIN_FAST_TO_SLOW_RATIO = 1.2;
/** Меньше двух рабочих отрезков — это не интервальная тренировка. */
const MIN_ACTIVE_LAPS = 2;

export interface DetectedWorkout {
  /** Позиции рабочих кругов в массиве laps (с 0). */
  activeIndexes: number[];
  /** Реальные дистанции рабочих кругов; null — схему выделить не удалось. */
  distancesM: number[] | null;
  warnings: string[];
}

export function detectWorkout(
  laps: Lap[],
  tolerancePct: number,
  warmupLaps: number,
): DetectedWorkout {
  if (warmupLaps >= laps.length) {
    return {
      activeIndexes: [],
      distancesM: null,
      warnings: [
        `Разминка ${warmupLaps} кругов, а в файле всего ${laps.length} — искать схему не в чем`,
      ],
    };
  }

  const activeIndexes = findIntervalStructure(laps, warmupLaps);
  if (activeIndexes.length === 0) {
    return {
      activeIndexes,
      distancesM: null,
      warnings: [
        `Не найдено чередование быстрых отрезков и отдыха начиная с круга ${warmupLaps + 1}`,
      ],
    };
  }

  const warnings: string[] = [];
  const distancesM = activeIndexes.map((i) => {
    const gps = laps[i].distanceM ?? 0;
    const round = matchRoundDistance(gps, tolerancePct);
    if (round === null) {
      warnings.push(
        `Круг ${laps[i].index} (${Math.round(gps)} м) не похож на целую дистанцию ` +
          `с допуском ${tolerancePct}% — задайте схему вручную`,
      );
    }
    return round;
  });

  // Частичную схему не отдаём: если хоть один отрезок не распознан, тега нет.
  if (warnings.length > 0) return { activeIndexes, distancesM: null, warnings };
  return { activeIndexes, distancesM: distancesM as number[], warnings };
}

/**
 * Позиции рабочих кругов при строгом чередовании «быстрый — медленный»,
 * начиная с первого круга после разминки (позиция warmupLaps).
 */
export function findIntervalStructure(laps: Lap[], warmupLaps: number): number[] {
  const speeds = laps.map(lapSpeed);
  // Разминку в деление на быстрые и медленные не берём: её темп исказил бы порог.
  const split = splitFastSlow(speeds.slice(warmupLaps));
  if (!split || split.fastMean < split.slowMean * MIN_FAST_TO_SLOW_RATIO) return [];

  const isFast = (i: number) => speeds[i] >= split.threshold;
  const activeIndexes: number[] = [];

  for (let i = warmupLaps; i < laps.length; i += 2) {
    if (!isFast(i)) break; // на месте рабочего отрезка медленный круг — схема закончилась
    activeIndexes.push(i);
    if (i + 1 < laps.length && isFast(i + 1)) break; // вместо отдыха быстрый круг — тоже конец
  }
  return activeIndexes.length >= MIN_ACTIVE_LAPS ? activeIndexes : [];
}

/**
 * Делит скорости на две группы (одномерный 2-means): перебираем все пороги
 * между соседними значениями и берём тот, где сумма квадратов отклонений
 * от средних двух групп минимальна.
 */
export function splitFastSlow(
  speeds: number[],
): { threshold: number; slowMean: number; fastMean: number } | null {
  const sorted = [...speeds].sort((a, b) => a - b);
  if (sorted.length < 2) return null;

  let best: { threshold: number; slowMean: number; fastMean: number; sse: number } | null = null;
  for (let k = 1; k < sorted.length; k++) {
    const slow = sorted.slice(0, k);
    const fast = sorted.slice(k);
    const slowMean = mean(slow);
    const fastMean = mean(fast);
    const sse = sumSquaredDeviation(slow, slowMean) + sumSquaredDeviation(fast, fastMean);
    if (!best || sse < best.sse) {
      best = { threshold: (sorted[k - 1] + sorted[k]) / 2, slowMean, fastMean, sse };
    }
  }
  return best && { threshold: best.threshold, slowMean: best.slowMean, fastMean: best.fastMean };
}

/** Средняя скорость круга по GPS, м/с. Круг без дистанции (стоял) — 0. */
export function lapSpeed(lap: Lap): number {
  return lap.distanceM && lap.durationSec ? lap.distanceM / lap.durationSec : 0;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sumSquaredDeviation(values: number[], center: number): number {
  return values.reduce((sum, v) => sum + (v - center) ** 2, 0);
}
