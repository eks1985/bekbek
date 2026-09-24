"use client";

// Повторный разбор: своя схема либо параметры режима auto. Схема проверяется
// прямо здесь (модуль workout-pattern чистый), разбор делает сервер —
// достаёт файл из бакета и перезаписывает запись в workouts.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  PATTERN_EXAMPLE,
  PATTERN_EXAMPLE_PLUS,
  WorkoutPatternError,
  parseWorkoutPattern,
} from "@/lib/fit/workout-pattern";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Mode = "auto" | "manual";

export type ReparseDefaults = {
  tolerancePct: number;
  warmupLaps: number;
  /** Схема текущего разбора: подставляется в поле на вкладке «Своя схема». */
  pattern: string;
  /** Кругов в файле: столько же значений нужно в схеме. null — файл не разобран. */
  lapCount: number | null;
  /** Каким режимом файл разобран сейчас — на его вкладке и открываем форму. */
  source: Mode | null;
};

/** Разбирает введённую схему: сколько значений вышло или что не так. */
function checkPattern(
  text: string,
  lapCount: number | null,
): { text: string; ok: boolean } | null {
  if (text.trim() === "") return null;
  try {
    const items = parseWorkoutPattern(text);
    // Пока файл не разобран, число кругов неизвестно — сверит сервер.
    if (lapCount === null) return { ok: true, text: `Значений: ${items.length}` };
    const ok = items.length === lapCount;
    return {
      ok,
      text: ok
        ? `Значений: ${items.length} — по кругам файла`
        : `Значений: ${items.length}, а кругов в файле ${lapCount}`,
    };
  } catch (err) {
    return { ok: false, text: err instanceof WorkoutPatternError ? err.message : String(err) };
  }
}

export function ReparseForm({
  fitFileId,
  defaults,
}: {
  fitFileId: string;
  defaults: ReparseDefaults;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(defaults.source ?? "auto");
  const [tolerance, setTolerance] = useState(String(defaults.tolerancePct));
  const [warmup, setWarmup] = useState(String(defaults.warmupLaps));
  const [pattern, setPattern] = useState(defaults.pattern);
  const [pending, setPending] = useState(false);

  const manual = mode === "manual";
  const check = manual ? checkPattern(pattern, defaults.lapCount) : null;

  async function reparse() {
    setPending(true);
    try {
      // При своей схеме допуск и разминка не применяются — их не отправляем.
      const body = manual
        ? { pattern: pattern.trim() }
        : { tolerancePct: Number(tolerance), warmupLaps: Number(warmup) };
      const res = await fetch(`/api/fit-files/${fitFileId}/reparse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error ?? "Не удалось разобрать файл");
        return;
      }

      toast.success(
        data.workoutTag
          ? `Разобрано: ${data.workoutTag}`
          : "Файл разобран, схема интервалов не найдена",
      );
      router.refresh(); // перечитать страницу с новым результатом
    } catch {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Base UI: значение группы — массив, по умолчанию выбран один элемент.
          Повторный клик по активной вкладке даёт пустой массив — режим не меняем. */}
      <ToggleGroup
        variant="outline"
        spacing={0}
        value={[mode]}
        onValueChange={(value) => {
          const next = value[0] as Mode | undefined;
          if (next) setMode(next);
        }}
        aria-label="Режим разбора"
      >
        <ToggleGroupItem value="auto" disabled={pending}>
          Автоматически
        </ToggleGroupItem>
        <ToggleGroupItem value="manual" disabled={pending}>
          Своя схема
        </ToggleGroupItem>
      </ToggleGroup>

      {manual ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pattern">Схема</Label>
          <Input
            id="pattern"
            placeholder={PATTERN_EXAMPLE}
            value={pattern}
            disabled={pending}
            onChange={(e) => setPattern(e.target.value)}
            aria-invalid={check?.ok === false}
          />
          {check && (
            <p className={check.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
              {check.text}
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tolerance">Допуск, %</Label>
            <Input
              id="tolerance"
              type="number"
              min={1}
              max={49}
              value={tolerance}
              disabled={pending}
              onChange={(e) => setTolerance(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="warmup">Кругов разминки</Label>
            <Input
              id="warmup"
              type="number"
              min={0}
              value={warmup}
              disabled={pending}
              onChange={(e) => setWarmup(e.target.value)}
            />
          </div>
        </div>
      )}

      <Note>
        {manual ? <PatternHint lapCount={defaults.lapCount} /> : <AutoHint />}
      </Note>

      <div>
        <Button onClick={reparse} disabled={pending || check?.ok === false}>
          {pending ? "Разбираем…" : "Разобрать заново"}
        </Button>
      </div>
    </div>
  );
}

/** Общая рамка для пояснений — чтобы оба режима выглядели одинаково. */
function Note({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-muted/40 p-3 text-sm">{children}</div>;
}

/** Что делает режим auto и на что влияют его параметры. */
function AutoHint() {
  return (
    <>
      <p>
        Рабочие круги определятся автоматически: после кругов разминки парсер ищет
        чередование быстрых отрезков и отдыха (подходит только для тренировок с чётким
        чередованием быстрый отрезок / отдых).
      </p>
      <p className="mt-2 text-muted-foreground">
        <span className="font-medium text-foreground">Допуск</span> — насколько дистанция
        круга по GPS может отличаться от «целой» (600 м вместо 588 м), чтобы отрезок
        зачёлся. <span className="font-medium text-foreground">Кругов разминки</span> —
        сколько первых кругов пропустить: схема ищется со следующего за ними.
      </p>
    </>
  );
}

/** Подсказка по формату схемы — тот же синтаксис, что у флага --workout. */
function PatternHint({ lapCount }: { lapCount: number | null }) {
  return (
    <>
      <p>
        Схема — значение на каждый круг файла{lapCount === null ? "" : ` (их ${lapCount})`}:
        длина в метрах рабочего отрезка либо дефис, если это разминка, отдых или заминка.
      </p>
      <p className="mt-1 font-mono">{PATTERN_EXAMPLE}</p>
      <p className="mt-2 text-muted-foreground">
        <span className="font-mono">Можно компактно, например 200x3</span> — то же самое, что и{" "}
        <span className="font-mono">200-200-200</span>: три отрезка с отдыхом между ними.
        Используйте + если несколько рабочих отрезков идут подряд без отдыха:
        <span className="font-mono">{PATTERN_EXAMPLE_PLUS}</span>. Два дефиса подряд — два
        нерабочих круга подряд, например два круга отдыха:{" "}
        <span className="font-mono">-200--400-</span>
      </p>
      {/* <p className="mt-1 font-mono">{PATTERN_EXAMPLE_PLUS}</p> */}
      <p className="mt-2 text-muted-foreground">
        Пробелы и запятые не нужны. В поле уже стоит текущий тег тренировки — его можно отредактировать и нажать Разобрать заново
      </p>
    </>
  );
}
