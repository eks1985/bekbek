// Шаг 4. Общие сведения о тренировке.
//
// Основа — сообщение session: в нём итоги, которые посчитали часы
// (дистанция, время, средний пульс…). Уклон и то, чего в session нет,
// досчитываем по точкам.

import type { FitMessages } from "@garmin/fitsdk";
import { mergeStats, statsFromFitMesg, statsFromPoints, emptyStats } from "./segment-stats";
import type { Point, WorkoutSource, WorkoutSummary } from "./types";
import { enumToString, isStepSport, roundOrNull, toDate } from "./units";

/** Разница между эпохой FIT (1989-12-31 00:00 UTC) и эпохой Unix, в секундах. */
const FIT_EPOCH_OFFSET_SEC = 631065600;

export function extractSummary(messages: FitMessages, points: Point[]): WorkoutSummary {
  // В файле может быть несколько сессий (мультиспорт) — пока берём первую.
  const session = messages.sessionMesgs?.[0];
  const sport = getSport(messages);

  const computed = points.length ? statsFromPoints(points, [0, points.length - 1]) : emptyStats();
  const stats = session ? mergeStats(computed, statsFromFitMesg(session, sport)) : computed;

  return {
    sport,
    subSport: enumToString(session?.subSport),
    profileName: session?.sportProfileName ?? null,
    startTimeLocal: toLocalTime(stats.startTime, messages),
    ...stats,
    cadenceUnit: isStepSport(sport) ? "spm" : "rpm",
    maxPower: session?.maxPower ?? null,
    normalizedPower: session?.normalizedPower ?? null,
    calories: session?.totalCalories ?? null,
    aerobicTrainingEffect: session?.totalTrainingEffect ?? null,
    anaerobicTrainingEffect: session?.totalAnaerobicTrainingEffect ?? null,
    trainingLoad: roundOrNull(session?.trainingLoadPeak, 1),
    // В FIT длина шага в миллиметрах.
    avgStepLengthM: roundOrNull(
      session?.avgStepLength === undefined ? undefined : session.avgStepLength / 1000,
      2,
    ),
    avgVerticalOscillationMm: roundOrNull(session?.avgVerticalOscillation, 1),
    avgStanceTimeMs: roundOrNull(session?.avgStanceTime, 1),
    lapCount: messages.lapMesgs?.length ?? 0,
  };
}

export function getSport(messages: FitMessages): string | null {
  return enumToString(messages.sessionMesgs?.[0]?.sport);
}

/** Откуда данные: устройство и версия. */
export function extractSource(
  messages: FitMessages,
  fileName: string | null,
  profileVersion: string,
): WorkoutSource {
  const fileId = messages.fileIdMesgs?.[0];
  const device = fileId?.productName ?? fileId?.garminProduct ?? fileId?.product;
  return {
    fileName,
    parsedAt: new Date().toISOString(),
    manufacturer: enumToString(fileId?.manufacturer),
    device: enumToString(device),
    fitProfileVersion: profileVersion,
  };
}

/**
 * Часы пишут время в UTC, а местное — только в activity.localTimestamp
 * (секунды от эпохи FIT без поправки на пояс). Разница двух значений и есть
 * часовой пояс на момент тренировки.
 */
function toLocalTime(startTimeIso: string | null, messages: FitMessages): string | null {
  const activity = messages.activityMesgs?.[0];
  const utc = toDate(activity?.timestamp);
  const local = activity?.localTimestamp;
  if (!startTimeIso || !utc || typeof local !== "number") return null;

  const offsetSec = local + FIT_EPOCH_OFFSET_SEC - utc.getTime() / 1000;
  // Пояса кратны 15 минутам — округляем, чтобы убрать дробные секунды.
  const offsetMin = Math.round(offsetSec / 60 / 15) * 15;

  const shifted = new Date(Date.parse(startTimeIso) + offsetMin * 60_000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offsetMin) % 60).padStart(2, "0");
  return `${shifted.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}
