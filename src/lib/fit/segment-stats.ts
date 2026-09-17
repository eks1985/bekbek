// Статистика отрезка — общая для кругов, сплитов и всей тренировки.
//
// Два источника:
//   statsFromPoints  — считаем сами по точкам (есть всегда, если есть точки);
//   statsFromFitMesg — готовые итоги часов из сообщений lap/session.
// mergeStats берёт значения часов там, где они есть (они точнее: часы считают
// по сырым данным), а остальное (уклон, высоты) — из нашего расчёта.

import type { LapMesg, SessionMesg } from "@garmin/fitsdk";
import type { Point, SegmentStats } from "./types";
import {
  formatDuration,
  formatPace,
  isStepSport,
  round,
  roundOrNull,
  speedToPace,
  toDate,
} from "./units";

/**
 * Порог набора высоты, м. Мелкие колебания барометра меньше порога
 * не считаются подъёмом/спуском — иначе набор завышается. 1 м подобран
 * по примеру: итог 74/77 м против 67/69 м у часов.
 */
const ASCENT_THRESHOLD_M = 1;

/** Числовые поля, из которых выводятся строки и темп. */
type BaseStats = Omit<
  SegmentStats,
  "duration" | "avgPaceSecPerKm" | "avgPace" | "bestPaceSecPerKm" | "bestPace"
>;

// ─── Расчёт по точкам ────────────────────────────────────────────────────────

/** Статистика по точкам с индексами from..to включительно. */
export function statsFromPoints(points: Point[], [from, to]: [number, number]): SegmentStats {
  const first = points[from];
  const last = points[to];
  const slice = points.slice(from, to + 1);

  const durationSec = last.timerSec - first.timerSec;
  const distanceM = diffOrNull(last.distanceM, first.distanceM);
  const startAltitudeM = firstNonNull(slice, (p) => p.altitudeM);
  const endAltitudeM = firstNonNull([...slice].reverse(), (p) => p.altitudeM);
  const { ascent, descent } = ascentDescent(slice);
  const grades = slice.map((p) => p.gradePct).filter(isNumber);

  return withDerived({
    startTime: first.time,
    durationSec: round(durationSec, 1),
    elapsedSec: round(last.elapsedSec - first.elapsedSec, 1),
    distanceM: roundOrNull(distanceM, 2),
    avgHeartRate: roundOrNull(timeWeightedAverage(points, from, to, (p) => p.heartRate)),
    maxHeartRate: max(slice.map((p) => p.heartRate)),
    avgSpeedMps: distanceM !== null && durationSec > 0 ? round(distanceM / durationSec, 3) : null,
    maxSpeedMps: max(slice.map((p) => p.speedMps)),
    avgCadence: roundOrNull(timeWeightedAverage(points, from, to, (p) => p.cadence)),
    avgPower: roundOrNull(timeWeightedAverage(points, from, to, (p) => p.power)),
    totalAscentM: slice.some((p) => p.altitudeM !== null) ? ascent : null,
    totalDescentM: slice.some((p) => p.altitudeM !== null) ? descent : null,
    startAltitudeM,
    endAltitudeM,
    avgGradePct:
      startAltitudeM !== null && endAltitudeM !== null && distanceM && distanceM >= 10
        ? round(((endAltitudeM - startAltitudeM) / distanceM) * 100, 1)
        : null,
    maxGradePct: grades.length ? Math.max(...grades) : null,
    minGradePct: grades.length ? Math.min(...grades) : null,
    pointRange: [from, to],
  });
}

/**
 * Среднее с весом по времени. При «умной записи» точки идут неравномерно,
 * и простое среднее перекосилось бы в сторону участков, где точек больше.
 * Значение точки i действует на интервале от i−1 до i.
 */
function timeWeightedAverage(
  points: Point[],
  from: number,
  to: number,
  pick: (p: Point) => number | null,
): number | null {
  let sum = 0;
  let weight = 0;
  for (let i = from + 1; i <= to; i++) {
    const value = pick(points[i]);
    const dt = points[i].timerSec - points[i - 1].timerSec;
    if (value === null || dt <= 0) continue;
    sum += value * dt;
    weight += dt;
  }
  if (weight > 0) return sum / weight;
  // Отрезок из одной точки — просто её значение.
  return pick(points[from]);
}

/** Набор и сброс высоты с порогом ASCENT_THRESHOLD_M (гистерезис). */
function ascentDescent(points: Point[]): { ascent: number; descent: number } {
  let reference: number | null = null;
  let ascent = 0;
  let descent = 0;
  for (const { altitudeM } of points) {
    if (altitudeM === null) continue;
    if (reference === null) {
      reference = altitudeM;
      continue;
    }
    const change = altitudeM - reference;
    if (change >= ASCENT_THRESHOLD_M) ascent += change;
    if (change <= -ASCENT_THRESHOLD_M) descent -= change;
    if (Math.abs(change) >= ASCENT_THRESHOLD_M) reference = altitudeM;
  }
  return { ascent: round(ascent), descent: round(descent) };
}

// ─── Итоги часов из lap/session ──────────────────────────────────────────────

/** Итоги из сообщения lap или session. Поля, которых нет в файле, — null. */
export function statsFromFitMesg(
  mesg: LapMesg | SessionMesg,
  sport: string | null,
): Partial<BaseStats> {
  const cadence = mesg.avgRunningCadence ?? mesg.avgCadence;
  const cadenceFactor = isStepSport(sport) ? 2 : 1;

  return {
    startTime: toDate(mesg.startTime)?.toISOString() ?? null,
    durationSec: roundOrNull(mesg.totalTimerTime, 1),
    elapsedSec: roundOrNull(mesg.totalElapsedTime, 1),
    distanceM: roundOrNull(mesg.totalDistance, 2),
    avgHeartRate: mesg.avgHeartRate ?? null,
    maxHeartRate: mesg.maxHeartRate ?? null,
    avgSpeedMps: roundOrNull(mesg.enhancedAvgSpeed ?? mesg.avgSpeed, 3),
    maxSpeedMps: roundOrNull(mesg.enhancedMaxSpeed ?? mesg.maxSpeed, 3),
    avgCadence:
      cadence === undefined
        ? null
        : round((cadence + (mesg.avgFractionalCadence ?? 0)) * cadenceFactor),
    avgPower: mesg.avgPower ?? null,
    totalAscentM: mesg.totalAscent ?? null,
    totalDescentM: mesg.totalDescent ?? null,
  };
}

// ─── Слияние ─────────────────────────────────────────────────────────────────

/** Значения часов перекрывают расчётные, если они есть (не null). */
export function mergeStats(computed: SegmentStats, fromFile: Partial<BaseStats>): SegmentStats {
  const merged: BaseStats = { ...computed };
  for (const [key, value] of Object.entries(fromFile) as [keyof BaseStats, unknown][]) {
    if (value !== null && value !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return withDerived(merged);
}

/** Пустая статистика — для круга, в который не попало ни одной точки. */
export function emptyStats(): SegmentStats {
  return withDerived({
    startTime: null,
    durationSec: null,
    elapsedSec: null,
    distanceM: null,
    avgHeartRate: null,
    maxHeartRate: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgCadence: null,
    avgPower: null,
    totalAscentM: null,
    totalDescentM: null,
    startAltitudeM: null,
    endAltitudeM: null,
    avgGradePct: null,
    maxGradePct: null,
    minGradePct: null,
    pointRange: null,
  });
}

/** Добавляет вычисляемые поля: темп и строки "5:11", "50:55". */
function withDerived(stats: BaseStats): SegmentStats {
  const avgPaceSecPerKm = speedToPace(stats.avgSpeedMps);
  const bestPaceSecPerKm = speedToPace(stats.maxSpeedMps);
  return {
    ...stats,
    duration: formatDuration(stats.durationSec),
    avgPaceSecPerKm,
    avgPace: formatPace(avgPaceSecPerKm),
    bestPaceSecPerKm,
    bestPace: formatPace(bestPaceSecPerKm),
  };
}

// ─── Поиск точек ─────────────────────────────────────────────────────────────

/** Индексы первой и последней точки в интервале времени [fromMs, toMs]. */
export function findPointRangeByTime(
  points: Point[],
  fromMs: number,
  toMs: number,
): [number, number] | null {
  const from = points.findIndex((p) => Date.parse(p.time) >= fromMs);
  if (from === -1) return null;
  let to = from - 1;
  while (to + 1 < points.length && Date.parse(points[to + 1].time) <= toMs) to++;
  return to >= from ? [from, to] : null;
}

// ─── Мелочи ──────────────────────────────────────────────────────────────────

function isNumber(value: number | null): value is number {
  return value !== null;
}

function max(values: (number | null)[]): number | null {
  const numbers = values.filter(isNumber);
  return numbers.length ? Math.max(...numbers) : null;
}

function diffOrNull(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

function firstNonNull(points: Point[], pick: (p: Point) => number | null): number | null {
  for (const p of points) {
    const value = pick(p);
    if (value !== null) return value;
  }
  return null;
}
