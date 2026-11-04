"use client";

// Таблица кругов с возможностью указать фактическую дистанцию руками: клик
// по значению дистанции → модалка → новое значение собирает схему (как
// «своя схема» в ReparseForm) и шлёт на тот же /reparse. formatWorkoutTag —
// чистая функция без зависимостей, безопасно тянуть прямо в клиент (см.
// reparse-form.tsx — тот же приём для parseWorkoutPattern).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatWorkoutTag, type WorkoutPatternItem } from "@/lib/fit/workout-pattern";
import type { StoredWorkout } from "@/lib/workouts/stored";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Lap = StoredWorkout["laps"][number];
type Scheme = StoredWorkout["workout"];

/** Круг в минутах с десятыми: 95.37 → "1:35.4". */
function formatLapTime(sec: number | null): string {
  if (sec === null) return "—";
  const totalTenths = Math.round(sec * 10);
  const minutes = Math.floor(totalTenths / 600);
  const secTenths = totalTenths % 600;
  const seconds = Math.floor(secTenths / 10);
  const tenths = secTenths % 10;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

/**
 * Какие круги пользователь уже указал руками. Дистанция по схеме есть и у
 * auto, и у manual (gpsDistanceM заполнен в обоих случаях) — но «своей»
 * дистанцию считаем только при source === "manual": это и есть правило —
 * как только человек задал хоть один круг сам, всё, что он не указал,
 * становится разминочным, даже если auto когда-то там что-то нашёл.
 */
function initialOverrides(laps: Lap[], scheme: Scheme): Map<number, number> {
  const overrides = new Map<number, number>();
  if (scheme?.source !== "manual") return overrides;
  for (const lap of laps) {
    if (lap.gpsDistanceM != null && lap.distanceM != null) {
      overrides.set(lap.index, lap.distanceM);
    }
  }
  return overrides;
}

export function LapsTable({
  fitFileId,
  laps,
  scheme,
}: {
  fitFileId: string;
  laps: Lap[];
  scheme: Scheme;
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState(() => initialOverrides(laps, scheme));
  const [open, setOpen] = useState(false);
  const [editingLap, setEditingLap] = useState<Lap | null>(null);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);

  if (laps.length === 0) return null;

  function openEdit(lap: Lap) {
    setEditingLap(lap);
    const current = overrides.get(lap.index) ?? Math.round(lap.distanceM ?? 0);
    setValue(current > 0 ? String(current) : "");
    setOpen(true);
  }

  /** Отправляет новый набор отметок одним пересчётом через /reparse. */
  async function apply(next: Map<number, number>, successMessage: (tag: string | null) => string) {
    const pattern: WorkoutPatternItem[] = laps.map((lap) => next.get(lap.index) ?? null);
    const tag = formatWorkoutTag(pattern);

    setPending(true);
    try {
      const res = await fetch(`/api/fit-files/${fitFileId}/reparse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pattern: tag }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось пересчитать схему");
        return;
      }
      setOverrides(next);
      setOpen(false);
      toast.success(successMessage(data.workoutTag ?? null));
      router.refresh();
    } catch {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  }

  function submit() {
    if (!editingLap) return;
    const meters = Number(value);
    if (!Number.isFinite(meters) || meters <= 0) {
      toast.error("Введите дистанцию в метрах, больше нуля");
      return;
    }
    const next = new Map(overrides);
    next.set(editingLap.index, meters);
    void apply(next, (tag) => (tag ? `Схема: ${tag}` : "Схема пересчитана"));
  }

  function clearEditingLap() {
    if (!editingLap) return;
    const next = new Map(overrides);
    next.delete(editingLap.index);
    void apply(next, () => "Круг снова считается разминочным");
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Круги по файлу</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="w-1/3 py-1 pr-3 text-right font-medium">Дистанция</th>
            <th className="w-1/6 py-1 px-3 text-right font-medium">Время</th>
            <th className="w-1/6 py-1 px-3 text-right font-medium">Темп</th>
            <th className="w-1/3 py-1 pl-3 text-left font-medium">Круг</th>
          </tr>
        </thead>
        <tbody>
          {laps.map((lap) => {
            // gpsDistanceM заполнен только у кругов, где схема подменила дистанцию.
            const fileDistance = lap.gpsDistanceM ?? lap.distanceM;
            const bySchema = lap.gpsDistanceM == null ? null : lap.distanceM;
            const isSetByUser = overrides.has(lap.index);
            return (
              <tr key={lap.index} className="border-b last:border-0">
                <td className="py-1 pr-3 text-right tabular-nums">
                  <button
                    type="button"
                    onClick={() => openEdit(lap)}
                    title="Указать фактическую дистанцию круга"
                    className={`underline decoration-dotted underline-offset-2 hover:decoration-solid ${
                      isSetByUser ? "font-semibold" : ""
                    }`}
                  >
                    {fileDistance === null ? "—" : Math.round(fileDistance)}
                  </button>
                  {bySchema !== null && (
                    <span className="text-muted-foreground"> → {Math.round(bySchema)}</span>
                  )}
                </td>
                <td className="py-1 px-3 text-right tabular-nums">
                  {formatLapTime(lap.durationSec)}
                </td>
                <td className="py-1 px-3 text-right tabular-nums">{lap.avgPace ?? "—"}</td>
                <td className="py-1 pl-3 text-left tabular-nums">{lap.index}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Круг {editingLap?.index}</DialogTitle>
          <DialogDescription>
            Фактическая дистанция, метры. Как только хоть один круг указан так, все
            остальные становятся разминочными («-» в схеме) — задайте по фактам и их.
          </DialogDescription>
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="lap-distance">Дистанция, м</Label>
            <Input
              id="lap-distance"
              type="number"
              min={1}
              value={value}
              disabled={pending}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            {editingLap && overrides.has(editingLap.index) ? (
              <Button variant="ghost" size="sm" disabled={pending} onClick={clearEditingLap}>
                Сделать разминочным
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <DialogClose
                render={
                  <Button variant="outline" disabled={pending}>
                    Отмена
                  </Button>
                }
              />
              <Button onClick={submit} disabled={pending}>
                {pending ? "Считаем…" : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
