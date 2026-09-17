// Разбор FIT-файла целиком. Читайте сверху вниз — это рецепт из шагов 1–6.

import { decodeFit } from "./1-decode";
import { extractPoints, findTimerPauses } from "./2-points";
import { addGrade } from "./3-grade";
import { extractSource, extractSummary, getSport } from "./4-summary";
import { extractLaps } from "./5-laps";
import { getKmSplits } from "./6-km-splits";
import type { ParsedWorkout } from "./types";

export interface ParseOptions {
  /** Имя файла для блока source. */
  fileName?: string;
  /** Класть ли в результат посекундные точки. По умолчанию да. */
  includePoints?: boolean;
}

export function parseWorkout(bytes: Uint8Array, options: ParseOptions = {}): ParsedWorkout {
  // 1. Байты → сообщения FIT
  const { messages, profileVersion } = decodeFit(bytes);
  const sport = getSport(messages);

  // 2. Точки записи + время по таймеру без пауз
  const pauses = findTimerPauses(messages.eventMesgs);
  const rawPoints = extractPoints(messages.recordMesgs, pauses, sport);

  // 3. Уклон в каждой точке
  const points = addGrade(rawPoints);

  // 4. Сводка по тренировке
  const summary = extractSummary(messages, points);

  // 5. Круги
  const laps = extractLaps(messages.lapMesgs, points, sport);

  // 6. Сплиты по километру
  const kmSplits = getKmSplits(laps, points);

  return {
    source: extractSource(messages, options.fileName ?? null, profileVersion),
    summary,
    laps,
    kmSplits,
    ...(options.includePoints === false ? {} : { points }),
  };
}
