// Краткая сводка разбора: то же, что печатает консольный парсер, но таблицей.
import type { StoredWorkout } from "@/lib/workouts/stored";

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

/** Дату старта показываем в поясе часов: startTimeLocal уже со смещением. */
function formatStart(summary: StoredWorkout["summary"]): string {
  const raw = summary.startTimeLocal ?? summary.startTime;
  return raw ? dateFormat.format(new Date(raw)) : "—";
}

function Row({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value === null ? "—" : value}</dd>
    </div>
  );
}

export function WorkoutSummary({ workout }: { workout: StoredWorkout }) {
  const s = workout.summary;
  const pulse =
    s.avgHeartRate === null
      ? null
      : `${s.avgHeartRate}${s.maxHeartRate === null ? "" : ` / ${s.maxHeartRate}`}`;

  return (
    <dl className="text-sm">
      <Row label="Старт" value={formatStart(s)} />
      <Row
        label="Дистанция"
        value={s.distanceM === null ? null : `${(s.distanceM / 1000).toFixed(2)} км`}
      />
      <Row label="Время" value={s.duration} />
      <Row label="Средний темп" value={s.avgPace === null ? null : `${s.avgPace}/км`} />
      <Row label="Пульс средний / макс" value={pulse} />
      <Row label="Набор высоты" value={s.totalAscentM === null ? null : `${s.totalAscentM} м`} />
      <Row label="Кругов" value={s.lapCount} />
    </dl>
  );
}
