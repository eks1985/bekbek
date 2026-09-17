// Схема интервальной тренировки: разбор строки, запись тега, «целые» дистанции.
// Функции чистые, про FIT и круги ничего не знают.

export class WorkoutPatternError extends Error {}

/** Допуск по умолчанию для поиска «целой» дистанции, %. */
export const DEFAULT_TOLERANCE_PCT = 5;

/** Элемент схемы: дистанция в метрах или null — «взять дистанцию круга из файла». */
export type WorkoutPatternItem = number | null;

/**
 * "200 400 600x3" → [200, 400, 600, 600, 600].
 * "-200-400-"     → [null, 200, null, 400, null].
 * Разделители — пробелы или запятые; повтор — x (латинская или русская) или ×.
 * Дефис — «дистанция из файла» и заодно разделитель: "-200-" = "- 200 -".
 * Дефисы допустимы только в полной разметке (это проверяет шаг 7).
 */
export function parseWorkoutPattern(text: string): WorkoutPatternItem[] {
  const tokens = text
    .split(/[\s,]+/)
    .flatMap((chunk) => chunk.split(/(-)/))
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new WorkoutPatternError('Схема пустая. Пример: --workout "200 400 600x3"');
  }

  const distances: WorkoutPatternItem[] = [];
  for (const token of tokens) {
    if (token === "-") {
      distances.push(null);
      continue;
    }
    const match = /^(\d+(?:\.\d+)?)(?:[xх×](\d+))?$/i.exec(token);
    const distance = Number(match?.[1]);
    const repeat = match?.[2] ? Number(match[2]) : 1;
    if (!match || distance <= 0 || repeat < 1) {
      throw new WorkoutPatternError(
        `Не понимаю «${token}» в схеме: нужны метры, например "200 400 600x3"`,
      );
    }
    for (let i = 0; i < repeat; i++) distances.push(distance);
  }
  return distances;
}

/** [200, 400, 600, 600, 600] → "200 400 600x3". Подряд идущие повторы сворачиваются. */
export function formatWorkoutTag(distances: number[]): string {
  const groups: { distance: number; count: number }[] = [];
  for (const distance of distances) {
    const last = groups.at(-1);
    if (last?.distance === distance) last.count++;
    else groups.push({ distance, count: 1 });
  }
  return groups
    .map(({ distance, count }) => (count > 1 ? `${distance}x${count}` : `${distance}`))
    .join(" ");
}

/**
 * «Целые» дистанции, к которым округляем отрезки:
 * каждые 100 м до 2 км (200, 400, 1200…), дальше каждые 500 м до 10 км.
 */
const ROUND_DISTANCES_M = [
  ...Array.from({ length: 20 }, (_, i) => (i + 1) * 100), // 100…2000
  ...Array.from({ length: 16 }, (_, i) => 2500 + i * 500), // 2500…10000
];

/**
 * Ближайшая «целая» дистанция, если GPS отличается от неё не больше чем на tolerancePct.
 * 588 → 600 (2 %), 985 → 1000 (1,5 %), 512 → null при допуске 5 %.
 */
export function matchRoundDistance(distanceM: number, tolerancePct: number): number | null {
  const nearest = ROUND_DISTANCES_M.reduce((best, d) =>
    Math.abs(d - distanceM) < Math.abs(best - distanceM) ? d : best,
  );
  return deviationPct(distanceM, nearest) <= tolerancePct ? nearest : null;
}

/** Насколько (в %) измеренная дистанция отличается от заданной. */
export function deviationPct(measuredM: number, expectedM: number): number {
  return (Math.abs(measuredM - expectedM) / expectedM) * 100;
}
