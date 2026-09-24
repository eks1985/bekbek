// Схема интервальной тренировки: разбор строки, запись тега, «целые» дистанции.
// Функции чистые, про FIT и круги ничего не знают.

export class WorkoutPatternError extends Error {}

/** Допуск по умолчанию для поиска «целой» дистанции, %. */
export const DEFAULT_TOLERANCE_PCT = 5;

/** Элемент схемы: дистанция в метрах или null — «взять дистанцию круга из файла». */
export type WorkoutPatternItem = number | null;

/** Пример формата — он же подсказка во всех сообщениях об ошибках. */
export const PATTERN_EXAMPLE = "-200-400-600-400-200-";

/** Пример с рабочими кругами подряд, без отдыха между ними. */
export const PATTERN_EXAMPLE_PLUS = "-200+400-200+400-";

/**
 * Схема — это все круги файла подряд: число — рабочий отрезок в метрах,
 * дефис — нерабочий круг (разминка, отдых, заминка). Значений должно быть
 * столько же, сколько кругов (проверяет шаг 7).
 *
 * "-200-400-"     → [null, 200, null, 400, null].
 * "-200x3-"       → [null, 200, null, 200, null, 200, null]: xN — отрезки
 *                   с отдыхом между ними, "200x3" ≡ "200-200-200".
 * "-200+400-"     → [null, 200, 400, null]: плюс соединяет рабочие круги,
 *                   идущие подряд (200 быстро и сразу 400 ещё быстрее).
 * "-200--400-"    → [null, 200, null, null, 400, null]: дефис подряд —
 *                   два нерабочих круга подряд (например, два круга отдыха).
 * Пробелы и запятые не принимаем: формат один.
 */
export function parseWorkoutPattern(text: string): WorkoutPatternItem[] {
  if (/[\s,]/.test(text)) {
    throw new WorkoutPatternError(
      `Схема записывается через дефис, без пробелов и запятых. Пример: "${PATTERN_EXAMPLE}"`,
    );
  }

  const tokens = text.split(/([-+])/).filter(Boolean);
  if (tokens.length === 0) {
    throw new WorkoutPatternError(`Схема пустая. Пример: "${PATTERN_EXAMPLE}"`);
  }

  const items: WorkoutPatternItem[] = [];
  for (const [i, token] of tokens.entries()) {
    if (token === "-") {
      items.push(null);
      continue;
    }
    if (token === "+") {
      // Плюс только склеивает два числа; своего круга у него нет.
      const between = isDistance(tokens[i - 1]) && isDistance(tokens[i + 1]);
      if (!between) {
        throw new WorkoutPatternError(
          `«+» ставится между двумя отрезками, например "${PATTERN_EXAMPLE_PLUS}"`,
        );
      }
      continue;
    }

    const match = DISTANCE_RE.exec(token);
    const distance = Number(match?.[1]);
    const repeat = match?.[2] ? Number(match[2]) : 1;
    if (!match || distance <= 0 || repeat < 1) {
      throw new WorkoutPatternError(
        `Не понимаю «${token}» в схеме: нужны метры, например "${PATTERN_EXAMPLE}"`,
      );
    }
    for (let k = 0; k < repeat; k++) {
      // Внутри xN между отрезками подразумевается отдых.
      if (k > 0) items.push(null);
      items.push(distance);
    }
  }
  return items;
}

/** Дистанция с необязательным повтором: "600" или "600x3". */
const DISTANCE_RE = /^(\d+(?:\.\d+)?)(?:[xх×](\d+))?$/i;

function isDistance(token: string | undefined): boolean {
  return token !== undefined && DISTANCE_RE.test(token);
}

/**
 * Круги → тег в том же формате, что и схема: [null,200,null,400,null] →
 * "-200-400-". Рабочие круги подряд разделяются плюсом: "-200+400-".
 * Одинаковые отрезки через один отдых сворачиваются: "-600x3-".
 * Тег можно вставить обратно в поле схемы и получить тот же разбор.
 */
export function formatWorkoutTag(items: WorkoutPatternItem[]): string {
  const parts: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === null) {
      parts.push("-");
      continue;
    }
    if (i > 0 && items[i - 1] !== null) {
      // Предыдущий круг тоже рабочий: отдыха между ними нет.
      parts.push("+");
    }

    // Сколько раз эта дистанция повторяется дальше через ровно один отдых.
    let repeat = 1;
    while (items[i + 1] === null && items[i + 2] === item) {
      repeat++;
      i += 2;
    }
    parts.push(repeat > 1 ? `${item}x${repeat}` : `${item}`);
  }

  return parts.join("");
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
