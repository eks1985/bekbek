// Шаг 6. Сплиты по 1 км.
//
// Если на часах был автокруг по 1 км, сплиты уже есть — это круги с
// trigger = distance. Иначе (ручные круги, интервалы) режем точки сами:
// новый сплит начинается в первой точке, где накопленная дистанция
// перешла очередную тысячу метров.

import { statsFromPoints } from "./segment-stats";
import type { KmSplit, KmSplits, Lap, Point } from "./types";

const KM = 1000;
/** Допуск, с которым круг часов считается километровым. */
const AUTO_LAP_TOLERANCE_M = 20;
/** Хвост короче этого не выводим отдельным сплитом. */
const MIN_PARTIAL_M = 10;

export function getKmSplits(laps: Lap[], points: Point[]): KmSplits {
  if (hasKmAutoLaps(laps)) {
    return { source: "file", items: lapsToSplits(laps) };
  }
  return { source: "computed", items: computeKmSplits(points) };
}

/** Все круги, кроме последнего, закрыты автокругом и длиной ≈ 1 км. */
function hasKmAutoLaps(laps: Lap[]): boolean {
  const full = laps.slice(0, -1);
  return (
    full.length > 0 &&
    full.every(
      (lap) =>
        lap.trigger === "distance" &&
        lap.distanceM !== null &&
        Math.abs(lap.distanceM - KM) <= AUTO_LAP_TOLERANCE_M,
    )
  );
}

function lapsToSplits(laps: Lap[]): KmSplit[] {
  return laps.map((lap) => {
    // Из круга оставляем только статистику: номер, trigger и intensity сплиту не нужны.
    const split: KmSplit & Partial<Lap> = {
      ...lap,
      km: lap.index,
      isPartial: (lap.distanceM ?? 0) < KM - AUTO_LAP_TOLERANCE_M,
    };
    delete split.index;
    delete split.trigger;
    delete split.intensity;
    return split;
  });
}

function computeKmSplits(points: Point[]): KmSplit[] {
  const withDistance = points.flatMap((p, i) => (p.distanceM !== null ? [i] : []));
  if (withDistance.length < 2) return [];

  const splits: KmSplit[] = [];
  let startIndex = withDistance[0];
  let nextBoundaryM = KM;

  for (const i of withDistance) {
    if (points[i].distanceM! < nextBoundaryM) continue;
    // Соседние сплиты делят граничную точку: конец одного = начало следующего.
    splits.push(makeSplit(points, startIndex, i, splits.length + 1, false));
    startIndex = i;
    // Если точки редкие и за один шаг пройдено больше километра — пропускаем границы.
    while (points[i].distanceM! >= nextBoundaryM) nextBoundaryM += KM;
  }

  const lastIndex = withDistance[withDistance.length - 1];
  const tailM = points[lastIndex].distanceM! - points[startIndex].distanceM!;
  if (lastIndex > startIndex && tailM >= MIN_PARTIAL_M) {
    splits.push(makeSplit(points, startIndex, lastIndex, splits.length + 1, true));
  }
  return splits;
}

function makeSplit(
  points: Point[],
  from: number,
  to: number,
  km: number,
  isPartial: boolean,
): KmSplit {
  return { km, isPartial, ...statsFromPoints(points, [from, to]) };
}
