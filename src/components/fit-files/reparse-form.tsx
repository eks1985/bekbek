"use client";

// Заготовка повторного разбора: поля и проверка ввода работают, кнопка пока
// неактивна — серверную часть (достать файл из бакета, разобрать заново,
// перезаписать workouts) делаем следующим шагом.
import { useState } from "react";
import { CircleHelp } from "lucide-react";
import {
  PATTERN_EXAMPLE,
  WorkoutPatternError,
  parseWorkoutPattern,
} from "@/lib/fit/workout-pattern";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ReparseDefaults = {
  tolerancePct: number;
  warmupLaps: number;
  /** Схема из текущего разбора — как подсказка в поле схемы. */
  pattern: string;
  /** Сколько кругов в файле: столько же значений должно быть в схеме. */
  lapCount: number;
};

/** Разбирает введённую схему: сколько значений вышло или что не так. */
function checkPattern(text: string, lapCount: number): { text: string; ok: boolean } | null {
  if (text.trim() === "") return null;
  try {
    const items = parseWorkoutPattern(text);
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

export function ReparseForm({ defaults }: { defaults: ReparseDefaults }) {
  const [tolerance, setTolerance] = useState(String(defaults.tolerancePct));
  const [warmup, setWarmup] = useState(String(defaults.warmupLaps));
  const [pattern, setPattern] = useState("");
  const [hintOpen, setHintOpen] = useState(false);

  const check = checkPattern(pattern, defaults.lapCount);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pattern">Своя схема</Label>
        <div className="flex items-center gap-2">
          <Input
            id="pattern"
            className="flex-1"
            placeholder={defaults.pattern || PATTERN_EXAMPLE}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            aria-invalid={check?.ok === false}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Как записывается схема"
            aria-expanded={hintOpen}
            onClick={() => setHintOpen((open) => !open)}
          >
            <CircleHelp />
          </Button>
        </div>
        {check && (
          <p className={check.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
            {check.text}
          </p>
        )}
        {hintOpen && <PatternHint lapCount={defaults.lapCount} />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tolerance">Допуск, %</Label>
          <Input
            id="tolerance"
            type="number"
            min={1}
            max={49}
            value={tolerance}
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
            onChange={(e) => setWarmup(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button disabled>Разобрать заново</Button>
        <p className="text-sm text-muted-foreground">Пока не работает — следующий шаг.</p>
      </div>
    </div>
  );
}

/** Подсказка по формату схемы — тот же синтаксис, что у флага --workout. */
function PatternHint({ lapCount }: { lapCount: number }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <p>
        Схема — значение на каждый круг файла (их {lapCount}): метры рабочего отрезка либо
        дефис, если круг нерабочий — разминка, трусца между отрезками, заминка.
      </p>
      <p className="mt-1 font-mono">{PATTERN_EXAMPLE}</p>
      <p className="mt-2 text-muted-foreground">
        <span className="font-mono">200x3</span> — то же, что{" "}
        <span className="font-mono">200-200-200</span>: три отрезка с отдыхом между ними.
        Пробелы и запятые не нужны. Готовый тег сверху можно скопировать сюда и поправить.
      </p>
    </div>
  );
}
