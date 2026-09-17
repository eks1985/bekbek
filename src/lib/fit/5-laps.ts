// Шаг 5. Круги (lap).
//
// Круг закрывается кнопкой Lap (trigger = manual), автокругом по дистанции
// или времени (distance / time), шагом тренировки или концом сессии
// (sessionEnd). Итоги круга часы пишут сами; уклон и высоты считаем по
// точкам, попавшим в круг.

import type { LapMesg } from "@garmin/fitsdk";
import {
  emptyStats,
  findPointRangeByTime,
  mergeStats,
  statsFromFitMesg,
  statsFromPoints,
} from "./segment-stats";
import type { Lap, Point } from "./types";
import { enumToString, toDate } from "./units";

export function extractLaps(lapMesgs: LapMesg[] = [], points: Point[], sport: string | null): Lap[] {
  return lapMesgs.map((lap, i) => {
    const range = findLapPoints(lap, points);
    const computed = range ? statsFromPoints(points, range) : emptyStats();
    const stats = mergeStats(computed, statsFromFitMesg(lap, sport));

    return {
      index: i + 1,
      trigger: enumToString(lap.lapTrigger),
      intensity: enumToString(lap.intensity),
      ...stats,
      pointRange: range,
    };
  });
}

/**
 * Какие точки принадлежат кругу.
 * Конец круга = старт + полное время. Поле timestamp для этого не годится:
 * у некоторых часов в первом круге оно равно времени старта.
 */
function findLapPoints(lap: LapMesg, points: Point[]): [number, number] | null {
  const start = toDate(lap.startTime);
  if (!start || lap.totalElapsedTime === undefined) return null;
  const startMs = start.getTime();
  return findPointRangeByTime(points, startMs, startMs + lap.totalElapsedTime * 1000);
}
