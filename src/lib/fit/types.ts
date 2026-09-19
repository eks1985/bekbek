// Типы результата парсинга. Это то, что попадает в JSON.
// Единицы — в суффиксе имени: M — метры, Sec — секунды, Mps — м/с, Pct — проценты.
// null означает «в файле нет данных для этого значения».

/** Одна точка записи (обычно раз в секунду). */
export interface Point {
  /** Время точки, ISO UTC. */
  time: string;
  /** Секунд от старта по таймеру: паузы не считаются. */
  timerSec: number;
  /** Секунд от старта по часам: паузы входят. */
  elapsedSec: number;
  distanceM: number | null;
  heartRate: number | null;
  speedMps: number | null;
  paceSecPerKm: number | null;
  altitudeM: number | null;
  /** Уклон в точке, % (плюс — подъём). Считается в шаге 3. */
  gradePct: number | null;
  /** Каденс: шаги в минуту для бега и ходьбы, об/мин для остального. */
  cadence: number | null;
  power: number | null;
  lat: number | null;
  lon: number | null;
}

/** Статистика любого отрезка: круга, сплита, всей тренировки. */
export interface SegmentStats {
  startTime: string | null;
  /** Время по таймеру (без пауз). */
  durationSec: number | null;
  duration: string | null;
  /** Полное время (с паузами). */
  elapsedSec: number | null;
  distanceM: number | null;

  avgHeartRate: number | null;
  maxHeartRate: number | null;

  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  avgPaceSecPerKm: number | null;
  avgPace: string | null;
  bestPaceSecPerKm: number | null;
  bestPace: string | null;

  avgCadence: number | null;
  avgPower: number | null;

  totalAscentM: number | null;
  totalDescentM: number | null;
  startAltitudeM: number | null;
  endAltitudeM: number | null;
  /** Средний уклон: (высота в конце − в начале) / дистанция. */
  avgGradePct: number | null;
  /** Самый крутой подъём на отрезке. */
  maxGradePct: number | null;
  /** Самый крутой спуск на отрезке (отрицательное число). */
  minGradePct: number | null;

  /** Индексы первой и последней точки отрезка в массиве points. */
  pointRange: [number, number] | null;
}

export interface WorkoutSummary extends SegmentStats {
  sport: string | null;
  subSport: string | null;
  /** Название спортивного профиля на часах, например «Run». */
  profileName: string | null;
  /** Тег интервальной тренировки, например "200 400 600 1000 600x3" (при --workout). */
  workoutTag: string | null;
  /** Время старта в часовом поясе часов, например 2026-09-09T20:18:31+03:00. */
  startTimeLocal: string | null;
  cadenceUnit: "spm" | "rpm";
  maxPower: number | null;
  normalizedPower: number | null;
  calories: number | null;
  aerobicTrainingEffect: number | null;
  anaerobicTrainingEffect: number | null;
  trainingLoad: number | null;
  avgStepLengthM: number | null;
  avgVerticalOscillationMm: number | null;
  avgStanceTimeMs: number | null;
  lapCount: number;
}

/** Роль круга в интервальной тренировке (заполняется при --workout). */
export type LapRole = "warmup" | "active" | "rest" | "cooldown";

export interface Lap extends SegmentStats {
  /** Номер круга, с 1. */
  index: number;
  /** Как круг закончился: manual, distance, time, sessionEnd… */
  trigger: string | null;
  /** Тип по тренировке, как его записали часы: active, rest, warmup, interval… */
  intensity: string | null;
  /** Роль по схеме --workout; null — схема не задана или полная разметка. */
  role: LapRole | null;
  /**
   * Есть только у кругов с реальной дистанцией из схемы. Тогда distanceM и
   * avgPace — по реальной дистанции, а здесь — исходные значения по GPS.
   */
  gpsDistanceM?: number | null;
  gpsAvgPaceSecPerKm?: number | null;
  gpsAvgPace?: string | null;
}

/** Результат применения схемы --workout. */
export interface WorkoutInfo {
  /** auto — найдена сама; manual — схема рабочих отрезков; manual-full — дистанция каждого круга. */
  source: "auto" | "manual" | "manual-full";
  /** Например "200 400 600 1000 600x3"; null — схему найти не удалось. */
  tag: string | null;
  /** Допуск округления до целой дистанции, % (только для auto). */
  tolerancePct: number | null;
  /** Сколько первых кругов считались разминкой (только для auto). */
  warmupLaps: number | null;
  /** Реальные дистанции кругов с заданной длиной. */
  distancesM: number[];
  /** Номера кругов (с 1), у которых дистанция и темп заменены реальными. */
  adjustedLapIndexes: number[];
  adjustedDistanceM: number | null;
  adjustedDurationSec: number | null;
  adjustedAvgPaceSecPerKm: number | null;
  adjustedAvgPace: string | null;
  warnings: string[];
}

export interface KmSplit extends SegmentStats {
  /** Номер километра, с 1. */
  km: number;
  /** Последний неполный километр. */
  isPartial: boolean;
}

export interface KmSplits {
  /** file — взяты автокруги часов по 1 км; computed — посчитаны по точкам. */
  source: "file" | "computed";
  items: KmSplit[];
}

export interface WorkoutSource {
  fileName: string | null;
  parsedAt: string;
  manufacturer: string | null;
  device: string | null;
  fitProfileVersion: string;
}

export interface ParsedWorkout {
  source: WorkoutSource;
  summary: WorkoutSummary;
  /** Схема интервалов; null — флаг --workout не задан. */
  workout: WorkoutInfo | null;
  laps: Lap[];
  kmSplits: KmSplits;
  /** Можно не выводить: см. флаг --no-points в CLI. */
  points?: Point[];
}
