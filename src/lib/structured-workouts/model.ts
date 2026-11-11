// Модель конструктора структурированных тренировок (прототип, только бег).
// Блоки соответствуют строительным блокам garminconnect.workout из
// garmin-sync/docs/structured-workouts.md: Warmup/Cooldown/Interval/Recovery
// — каждый может закончиться по времени, по дистанции или нажатием кнопки
// круга (условие окончания задаётся StepCondition одинаково для всех ролей).
// Repeat — повтор нескольких Interval/Recovery. Функции здесь чистые, без
// знания о React — используются и конструктором, и генератором кода.

export type StepCondition =
  | { type: "time"; durationSec: number }
  | { type: "distance"; distanceM: number }
  | { type: "lapButton" };

export type PaceRange = { fast: string; slow: string };

export type RepeatChild =
  | { id: string; kind: "interval"; condition: StepCondition; pace: PaceRange | null }
  | { id: string; kind: "recovery"; condition: StepCondition };

export type WorkoutBlock =
  | { id: string; kind: "warmup"; condition: StepCondition }
  | { id: string; kind: "cooldown"; condition: StepCondition }
  | { id: string; kind: "interval"; condition: StepCondition; pace: PaceRange | null }
  | { id: string; kind: "recovery"; condition: StepCondition }
  | { id: string; kind: "repeat"; iterations: number; steps: RepeatChild[] };

export function newId(): string {
  return crypto.randomUUID();
}

export function timeCondition(durationSec: number): StepCondition {
  return { type: "time", durationSec };
}

export function distanceCondition(distanceM: number): StepCondition {
  return { type: "distance", distanceM };
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

/**
 * Дистанция шага, если её вообще можно назвать числом: впрямую — при
 * условии «дистанция», оценкой через темп — при «время» у отрезка. У
 * кнопки круга и у «время» без темпа дистанция не определена — 0 (не
 * участвует в сумме, см. totalDistanceM).
 */
function stepDistanceM(condition: StepCondition, pace: PaceRange | null): number {
  if (condition.type === "distance") return condition.distanceM;
  if (condition.type === "time") {
    const parsed = parsedPaceRange(pace);
    if (!parsed) return 0;
    const midSecPerKm = (parsed.fastSecPerKm + parsed.slowSecPerKm) / 2;
    return (condition.durationSec / midSecPerKm) * 1000;
  }
  return 0;
}

/**
 * Время шага — null, если не оценить: кнопка круга (решает живой человек),
 * либо «дистанция» без известного темпа (темп есть только у интервала).
 */
function stepDurationSec(condition: StepCondition, pace: PaceRange | null): number | null {
  if (condition.type === "time") return condition.durationSec;
  if (condition.type === "lapButton") return null;
  const parsed = parsedPaceRange(pace);
  if (!parsed) return null;
  const midSecPerKm = (parsed.fastSecPerKm + parsed.slowSecPerKm) / 2;
  return (condition.distanceM / 1000) * midSecPerKm;
}

function childPace(step: RepeatChild): PaceRange | null {
  return step.kind === "interval" ? step.pace : null;
}

export function blockDistanceM(block: WorkoutBlock): number {
  if (block.kind === "repeat") {
    const perRound = block.steps.reduce(
      (sum, s) => sum + stepDistanceM(s.condition, childPace(s)),
      0,
    );
    return perRound * block.iterations;
  }
  if (block.kind === "interval") return stepDistanceM(block.condition, block.pace);
  return stepDistanceM(block.condition, null);
}

/** null — где-то в цепочке шаг с неизвестным временем, оценить нельзя. */
export function blockDurationSec(block: WorkoutBlock): number | null {
  if (block.kind === "repeat") {
    let perRound = 0;
    for (const s of block.steps) {
      const d = stepDurationSec(s.condition, childPace(s));
      if (d === null) return null;
      perRound += d;
    }
    return perRound * block.iterations;
  }
  const pace = block.kind === "interval" ? block.pace : null;
  return stepDurationSec(block.condition, pace);
}

export function totalDistanceM(blocks: WorkoutBlock[]): number {
  return blocks.reduce((sum, b) => sum + blockDistanceM(b), 0);
}

/** null, если хоть один блок не оценить. */
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
      return `Разминка, ${describeCondition(block.condition)}`;
    case "cooldown":
      return `Заминка, ${describeCondition(block.condition)}`;
    case "recovery":
      return `Отдых, ${describeCondition(block.condition)}`;
    case "interval":
      return `Отрезок, ${describeCondition(block.condition)}${describePace(block.pace)}`;
    case "repeat":
      return `${block.iterations} × (${block.steps.map(describeChild).join(" + ")})`;
  }
}

function describeChild(step: RepeatChild): string {
  return step.kind === "interval"
    ? `отрезок ${describeCondition(step.condition)}${describePace(step.pace)}`
    : `отдых ${describeCondition(step.condition)}`;
}

function describeCondition(condition: StepCondition): string {
  switch (condition.type) {
    case "time":
      return formatMinSec(condition.durationSec);
    case "distance":
      return `${condition.distanceM} м`;
    case "lapButton":
      return "по кнопке круга";
  }
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
