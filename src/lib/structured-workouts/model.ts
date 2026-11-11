// Модель конструктора структурированных тренировок (прототип, только бег).
// Блоки соответствуют строительным блокам garminconnect.workout из
// garmin-sync/docs/structured-workouts.md: Warmup/Cooldown — время,
// Interval — дистанция + опциональный темп-таргет, Recovery — время,
// Repeat — повтор нескольких Interval/Recovery. Функции здесь чистые,
// без знания о React — используются и конструктором, и генератором кода.

export type PaceRange = { fast: string; slow: string };

export type RepeatChild =
  | { id: string; kind: "interval"; distanceM: number; pace: PaceRange | null }
  | { id: string; kind: "recovery"; durationSec: number };

export type WorkoutBlock =
  | { id: string; kind: "warmup"; durationSec: number }
  | { id: string; kind: "cooldown"; durationSec: number }
  | { id: string; kind: "interval"; distanceM: number; pace: PaceRange | null }
  | { id: string; kind: "recovery"; durationSec: number }
  | { id: string; kind: "repeat"; iterations: number; steps: RepeatChild[] };

export function newId(): string {
  return crypto.randomUUID();
}

/** "4:30" → 270, "4:5" → 245. null, если не похоже на мин:сек. */
export function parsePaceInput(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2}):([0-5]?\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 270 → "4:30" */
export function formatPaceInput(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")}`;
}

/**
 * Границы без учёта порядка ввода: быстрее — меньше секунд на км, это и
 * есть upper_limit по скорости (м/с); медленнее — lower_limit. Если хоть
 * одна граница не распозналась, цели нет (интервал «открытый»).
 */
export function parsedPaceRange(
  pace: PaceRange | null,
): { fastSecPerKm: number; slowSecPerKm: number } | null {
  if (!pace) return null;
  const a = parsePaceInput(pace.fast);
  const b = parsePaceInput(pace.slow);
  if (a === null || b === null) return null;
  return { fastSecPerKm: Math.min(a, b), slowSecPerKm: Math.max(a, b) };
}

function intervalDurationSec(distanceM: number, pace: PaceRange | null): number | null {
  const parsed = parsedPaceRange(pace);
  if (!parsed) return null;
  const midSecPerKm = (parsed.fastSecPerKm + parsed.slowSecPerKm) / 2;
  return (distanceM / 1000) * midSecPerKm;
}

export function blockDistanceM(block: WorkoutBlock): number {
  if (block.kind === "interval") return block.distanceM;
  if (block.kind === "repeat") {
    const perRound = block.steps.reduce(
      (sum, s) => sum + (s.kind === "interval" ? s.distanceM : 0),
      0,
    );
    return perRound * block.iterations;
  }
  return 0;
}

/** null — где-то в цепочке интервал без темп-таргета, оценить время нельзя. */
export function blockDurationSec(block: WorkoutBlock): number | null {
  switch (block.kind) {
    case "warmup":
    case "cooldown":
    case "recovery":
      return block.durationSec;
    case "interval":
      return intervalDurationSec(block.distanceM, block.pace);
    case "repeat": {
      let perRound = 0;
      for (const s of block.steps) {
        if (s.kind === "recovery") {
          perRound += s.durationSec;
        } else {
          const d = intervalDurationSec(s.distanceM, s.pace);
          if (d === null) return null;
          perRound += d;
        }
      }
      return perRound * block.iterations;
    }
  }
}

export function totalDistanceM(blocks: WorkoutBlock[]): number {
  return blocks.reduce((sum, b) => sum + blockDistanceM(b), 0);
}

/** null, если хоть один блок не оценить (интервал без темпа). */
export function totalDurationSec(blocks: WorkoutBlock[]): number | null {
  let total = 0;
  for (const b of blocks) {
    const d = blockDurationSec(b);
    if (d === null) return null;
    total += d;
  }
  return total;
}

/** Человеко-читаемое описание блока — для списка-превью. */
export function describeBlock(block: WorkoutBlock): string {
  switch (block.kind) {
    case "warmup":
      return `Разминка, ${formatMinSec(block.durationSec)}`;
    case "cooldown":
      return `Заминка, ${formatMinSec(block.durationSec)}`;
    case "recovery":
      return `Отдых, ${formatMinSec(block.durationSec)}`;
    case "interval":
      return `Отрезок ${block.distanceM} м${describePace(block.pace)}`;
    case "repeat":
      return `${block.iterations} × (${block.steps.map(describeChild).join(" + ")})`;
  }
}

function describeChild(step: RepeatChild): string {
  return step.kind === "interval"
    ? `${step.distanceM} м${describePace(step.pace)}`
    : `отдых ${formatMinSec(step.durationSec)}`;
}

function describePace(pace: PaceRange | null): string {
  const parsed = parsedPaceRange(pace);
  if (!parsed) return "";
  return ` по ${formatPaceInput(parsed.fastSecPerKm)}–${formatPaceInput(parsed.slowSecPerKm)}/км`;
}

function formatMinSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m} мин` : `${m}:${String(s).padStart(2, "0")}`;
}
