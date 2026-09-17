// Шаг 2. Сообщения record → массив точек.
//
// record — это «снимок» датчиков: обычно раз в секунду, при «умной записи»
// реже. В каждой точке есть время, дистанция с начала, скорость, пульс, высота,
// координаты. Здесь мы только переводим единицы и считаем время по таймеру —
// уклон добавляется отдельно, в шаге 3.

import type { EventMesg, RecordMesg } from "@garmin/fitsdk";
import type { Point } from "./types";
import {
  isStepSport,
  round,
  roundOrNull,
  semicirclesToDegrees,
  speedToPace,
  toDate,
} from "./units";

/** Интервал, когда таймер часов стоял (мс с эпохи Unix). */
export interface TimerPause {
  from: number;
  to: number;
}

const TIMER_STOP_TYPES = new Set(["stop", "stopAll", "stopDisable", "stopDisableAll"]);

/**
 * Паузы восстанавливаем по событиям таймера: stop … start.
 * В паузе часы обычно не пишут точки, и без этого время паузы
 * попало бы в отрезок между соседними точками.
 */
export function findTimerPauses(events: EventMesg[] = []): TimerPause[] {
  const timerEvents = events
    .filter((e) => String(e.event) === "timer" && toDate(e.timestamp))
    .sort((a, b) => toDate(a.timestamp)!.getTime() - toDate(b.timestamp)!.getTime());

  const pauses: TimerPause[] = [];
  let stoppedAt: number | null = null;

  for (const event of timerEvents) {
    const time = toDate(event.timestamp)!.getTime();
    const type = String(event.eventType);

    if (TIMER_STOP_TYPES.has(type) && stoppedAt === null) {
      stoppedAt = time;
    } else if (type === "start" && stoppedAt !== null) {
      pauses.push({ from: stoppedAt, to: time });
      stoppedAt = null;
    }
  }
  return pauses;
}

export function extractPoints(
  records: RecordMesg[] = [],
  pauses: TimerPause[],
  sport: string | null,
): Point[] {
  const cadenceFactor = isStepSport(sport) ? 2 : 1;
  const points: Point[] = [];
  let startMs: number | null = null;
  let prevMs: number | null = null;
  let timerSec = 0;

  for (const record of records) {
    const date = toDate(record.timestamp);
    if (!date) continue;
    const ms = date.getTime();

    startMs ??= ms;
    if (prevMs !== null) {
      timerSec += (ms - prevMs - pausedMsBetween(prevMs, ms, pauses)) / 1000;
    }
    prevMs = ms;

    // enhanced* — расширенные поля (больше диапазон); старые файлы пишут только speed/altitude.
    const speed = record.enhancedSpeed ?? record.speed;
    const altitude = record.enhancedAltitude ?? record.altitude;
    const cadence =
      record.cadence === undefined
        ? undefined
        : (record.cadence + (record.fractionalCadence ?? 0)) * cadenceFactor;

    points.push({
      time: date.toISOString(),
      timerSec: round(timerSec, 1),
      elapsedSec: (ms - startMs) / 1000,
      distanceM: roundOrNull(record.distance, 2),
      heartRate: record.heartRate ?? null,
      speedMps: roundOrNull(speed, 3),
      paceSecPerKm: speedToPace(speed),
      altitudeM: roundOrNull(altitude, 1),
      gradePct: roundOrNull(record.grade, 1), // обычно пусто — тогда посчитаем в шаге 3
      cadence: roundOrNull(cadence),
      power: record.power ?? null,
      lat: semicirclesToDegrees(record.positionLat),
      lon: semicirclesToDegrees(record.positionLong),
    });
  }
  return points;
}

/** Сколько миллисекунд из интервала [from, to] таймер стоял на паузе. */
function pausedMsBetween(from: number, to: number, pauses: TimerPause[]): number {
  let paused = 0;
  for (const pause of pauses) {
    const overlap = Math.min(to, pause.to) - Math.max(from, pause.from);
    if (overlap > 0) paused += overlap;
  }
  return paused;
}
