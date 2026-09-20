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
    <div className="flex flex-col gap-4">
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

      <Laps laps={workout.laps} />
    </div>
  );
}

/**
 * Круги так, как они лежат в файле: номер и дистанция по GPS. Если схема
 * заменила дистанцию круга реальной, показываем обе — видно, к чему привела
 * схема и насколько врал GPS.
 */
function Laps({ laps }: { laps: StoredWorkout["laps"] }) {
  if (laps.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Круги по файлу</p>
      {/* Колонки по половине ширины: номер круга и дистанция сходятся
          к середине карточки, читать пару значений проще. */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="w-1/2 py-1 pr-3 text-right font-medium">Дистанция</th>
            <th className="w-1/2 py-1 pl-3 text-left font-medium">Круг</th>
          </tr>
        </thead>
        <tbody>
          {laps.map((lap) => {
            // gpsDistanceM заполнен только у кругов, где схема подменила дистанцию.
            const fileDistance = lap.gpsDistanceM ?? lap.distanceM;
            const bySchema = lap.gpsDistanceM == null ? null : lap.distanceM;
            return (
              <tr key={lap.index} className="border-b last:border-0">
                <td className="py-1 pr-3 text-right tabular-nums">
                  {fileDistance === null ? "—" : `${Math.round(fileDistance)} м`}
                  {bySchema !== null && (
                    <span className="text-muted-foreground"> → {Math.round(bySchema)} м</span>
                  )}
                </td>
                <td className="py-1 pl-3 text-left tabular-nums">{lap.index}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
