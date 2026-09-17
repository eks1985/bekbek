// Перевод единиц и форматирование. Функции чистые, без знания о FIT.

/** Ниже этой скорости (м/с) считаем, что человек стоит, и темп не показываем. */
export const MIN_MOVING_SPEED_MPS = 0.5;

/** Координаты в FIT хранятся в «семикругах»: 2^31 = 180°. */
export function semicirclesToDegrees(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return round(value * (180 / 2 ** 31), 7);
}

/** м/с → секунд на километр. */
export function speedToPace(speedMps: number | null | undefined): number | null {
  if (!speedMps || speedMps < MIN_MOVING_SPEED_MPS) return null;
  return round(1000 / speedMps, 1);
}

/** 311.4 → "5:11" */
export function formatPace(secPerKm: number | null): string | null {
  if (secPerKm === null) return null;
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

/** 3054.5 → "50:55", 4000 → "1:06:40" */
export function formatDuration(sec: number | null): string | null {
  if (sec === null) return null;
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * В FIT каденс бега записан «на одну ногу» (88), а часы показывают шаги
 * в минуту (176). Для бега и ходьбы удваиваем.
 */
export function isStepSport(sport: string | null): boolean {
  return sport === "running" || sport === "walking" || sport === "hiking";
}

export function round(value: number, digits = 0): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

/** round для необязательных значений: undefined/NaN → null. */
export function roundOrNull(value: number | null | undefined, digits = 0): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return round(value, digits);
}

/**
 * SDK отдаёт даты как Date. Бывают и числа (конвертация выключена)
 * или служебная строка "min" — такие значения считаем отсутствующими.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  return null;
}

/** Enum'ы SDK приходят строками ("running"), но в типах объявлены числами. */
export function enumToString(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
