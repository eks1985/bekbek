"use client";

// Повторный разбор: своя схема либо параметры режима auto. Схема проверяется
// прямо здесь (модуль workout-pattern чистый), разбор делает сервер —
// достаёт файл из бакета и перезаписывает запись в workouts.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleHelp } from "lucide-react";
import {
  PATTERN_EXAMPLE,
  PATTERN_EXAMPLE_PLUS,
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
  /** Кругов в файле: столько же значений нужно в схеме. null — файл не разобран. */
  lapCount: number | null;
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
  const [tolerance, setTolerance] = useState(String(defaults.tolerancePct));
  const [warmup, setWarmup] = useState(String(defaults.warmupLaps));
  const [pattern, setPattern] = useState("");
  const [hintOpen, setHintOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const check = checkPattern(pattern, defaults.lapCount);
  const manual = pattern.trim() !== "";

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
            disabled={manual || pending}
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
            disabled={manual || pending}
            onChange={(e) => setWarmup(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={reparse} disabled={pending || check?.ok === false}>
          {pending ? "Разбираем…" : "Разобрать заново"}
        </Button>
        {manual && (
          <p className="text-sm text-muted-foreground">
            При своей схеме допуск и разминка не применяются.
          </p>
        )}
      </div>
    </div>
  );
}

/** Подсказка по формату схемы — тот же синтаксис, что у флага --workout. */
function PatternHint({ lapCount }: { lapCount: number | null }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <p>
        Схема — значение на каждый круг файла{lapCount === null ? "" : ` (их ${lapCount})`}:
        метры рабочего отрезка либо дефис, если круг нерабочий — разминка, трусца между
        отрезками, заминка.
      </p>
      <p className="mt-1 font-mono">{PATTERN_EXAMPLE}</p>
      <p className="mt-2 text-muted-foreground">
        <span className="font-mono">200x3</span> — то же, что{" "}
        <span className="font-mono">200-200-200</span>: три отрезка с отдыхом между ними.
        Плюс соединяет рабочие круги, идущие подряд, без отдыха:
      </p>
      <p className="mt-1 font-mono">{PATTERN_EXAMPLE_PLUS}</p>
      <p className="mt-2 text-muted-foreground">
        Пробелы и запятые не нужны. Готовый тег сверху можно скопировать сюда и поправить.
      </p>
    </div>
  );
}
