// Шаг 3. Уклон в каждой точке.
//
// Часы почти никогда не пишут уклон, поэтому считаем его сами:
//   уклон % = Δвысоты / Δдистанции × 100.
// Считать между соседними точками нельзя: за секунду бегун пробегает ~3–4 м,
// а шаг барометра ~0,2 м — выйдут скачки ±5–10 % на ровном месте.
// Поэтому берём окно ±WINDOW_HALF_M метров вокруг точки.

import type { Point } from "./types";
import { round } from "./units";

/** Половина окна сглаживания, м. */
const WINDOW_HALF_M = 25;
/** Если в окне меньше этой дистанции (стоим на месте), уклон не считаем. */
const MIN_SPAN_M = 10;

export function addGrade(points: Point[]): Point[] {
  // Устройство само записало уклон — доверяем ему.
  if (points.some((p) => p.gradePct !== null)) return points;

  // Работаем только с точками, где есть и дистанция, и высота.
  const valid = points.flatMap((p, i) =>
    p.distanceM !== null && p.altitudeM !== null
      ? [{ i, distance: p.distanceM, altitude: p.altitudeM }]
      : [],
  );

  const result = points.map((p) => ({ ...p }));

  // Два указателя: lo — первая точка окна, hi — последняя. Оба идут только вперёд.
  let lo = 0;
  let hi = 0;
  for (let k = 0; k < valid.length; k++) {
    const center = valid[k].distance;
    while (valid[lo].distance < center - WINDOW_HALF_M) lo++;
    if (hi < k) hi = k;
    while (hi + 1 < valid.length && valid[hi + 1].distance <= center + WINDOW_HALF_M) hi++;

    const span = valid[hi].distance - valid[lo].distance;
    if (span < MIN_SPAN_M) continue;

    const rise = valid[hi].altitude - valid[lo].altitude;
    result[valid[k].i].gradePct = round((rise / span) * 100, 1);
  }
  return result;
}
