"use client";

// Прототип конструктора структурированных тренировок (бег): пользователь
// собирает шаги вручную (разминка/отрезки/повторы/отдых/заминка), у каждого
// шага — своё условие окончания (время/дистанция/кнопка круга, см. model.ts
// StepCondition). Видим человеко-читаемое превью и код Python-вызова
// garminconnect — тот самый, которым создаётся тренировка в реальном
// Garmin-аккаунте (см. garmin-sync/docs/structured-workouts.md). Отправки в
// Garmin здесь нет — это следующий шаг после прототипа.
import { useId, useState } from "react";
import { toast } from "sonner";
import { formatDuration } from "@/lib/fit/units";
import {
  describeBlock,
  distanceCondition,
  newId,
  timeCondition,
  totalDistanceM,
  totalDurationSec,
  type PaceRange,
  type RepeatChild,
  type StepCondition,
  type WorkoutBlock,
} from "@/lib/structured-workouts/model";
import { generatePythonSnippet } from "@/lib/structured-workouts/python-snippet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function defaultBlock(kind: WorkoutBlock["kind"]): WorkoutBlock {
  switch (kind) {
    case "warmup":
      return { id: newId(), kind, condition: timeCondition(600) };
    case "cooldown":
      return { id: newId(), kind, condition: timeCondition(600) };
    case "recovery":
      return { id: newId(), kind, condition: timeCondition(90) };
    case "interval":
      return { id: newId(), kind, condition: distanceCondition(400), pace: null };
    case "repeat":
      return {
        id: newId(),
        kind,
        iterations: 4,
        steps: [
          { id: newId(), kind: "interval", condition: distanceCondition(400), pace: null },
          { id: newId(), kind: "recovery", condition: timeCondition(90) },
        ],
      };
  }
}

// Фиксированные id для стартового набора блоков — нужны одинаковыми на
// сервере и клиенте, иначе React.useState(() => [...crypto.randomUUID()])
// даст разные id при SSR и при гидратации и сломает её.
const INITIAL_BLOCKS: WorkoutBlock[] = [
  { id: "seed-warmup", kind: "warmup", condition: timeCondition(600) },
  {
    id: "seed-repeat",
    kind: "repeat",
    iterations: 4,
    steps: [
      { id: "seed-repeat-interval", kind: "interval", condition: distanceCondition(400), pace: null },
      { id: "seed-repeat-recovery", kind: "recovery", condition: timeCondition(90) },
    ],
  },
  { id: "seed-cooldown", kind: "cooldown", condition: timeCondition(600) },
];

export function WorkoutBuilder() {
  const [name, setName] = useState("Моя тренировка");
  const [blocks, setBlocks] = useState<WorkoutBlock[]>(INITIAL_BLOCKS);

  function addBlock(kind: WorkoutBlock["kind"]) {
    setBlocks((prev) => [...prev, defaultBlock(kind)]);
  }

  function updateBlock(id: string, next: Partial<WorkoutBlock>) {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? ({ ...b, ...next } as WorkoutBlock) : b)),
    );
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  function moveBlock(id: string, dir: -1 | 1) {
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function addChild(blockId: string, kind: RepeatChild["kind"]) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId && b.kind === "repeat"
          ? {
              ...b,
              steps: [
                ...b.steps,
                kind === "interval"
                  ? { id: newId(), kind, condition: distanceCondition(400), pace: null }
                  : { id: newId(), kind, condition: timeCondition(90) },
              ],
            }
          : b,
      ),
    );
  }

  function updateChild(blockId: string, childId: string, next: Partial<RepeatChild>) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId && b.kind === "repeat"
          ? {
              ...b,
              steps: b.steps.map((s) =>
                s.id === childId ? ({ ...s, ...next } as RepeatChild) : s,
              ),
            }
          : b,
      ),
    );
  }

  function removeChild(blockId: string, childId: string) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId && b.kind === "repeat"
          ? { ...b, steps: b.steps.filter((s) => s.id !== childId) }
          : b,
      ),
    );
  }

  const distanceM = totalDistanceM(blocks);
  const durationSec = totalDurationSec(blocks);
  const snippet = generatePythonSnippet(name, blocks);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success("Код скопирован");
    } catch {
      toast.error("Не удалось скопировать — браузер не дал доступ к буферу обмена");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Название</CardTitle>
        </CardHeader>
        <CardContent>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {blocks.map((block, i) => (
          <BlockCard
            key={block.id}
            block={block}
            isFirst={i === 0}
            isLast={i === blocks.length - 1}
            onChange={(next) => updateBlock(block.id, next)}
            onRemove={() => removeBlock(block.id)}
            onMove={(dir) => moveBlock(block.id, dir)}
            onAddChild={(kind) => addChild(block.id, kind)}
            onChangeChild={(childId, next) => updateChild(block.id, childId, next)}
            onRemoveChild={(childId) => removeChild(block.id, childId)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => addBlock("warmup")}>
          + Разминка
        </Button>
        <Button variant="outline" size="sm" onClick={() => addBlock("interval")}>
          + Отрезок
        </Button>
        <Button variant="outline" size="sm" onClick={() => addBlock("recovery")}>
          + Отдых
        </Button>
        <Button variant="outline" size="sm" onClick={() => addBlock("repeat")}>
          + Повтор
        </Button>
        <Button variant="outline" size="sm" onClick={() => addBlock("cooldown")}>
          + Заминка
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Превью</CardTitle>
          <CardDescription>
            {(distanceM / 1000).toFixed(2)} км
            {durationSec === null
              ? " · время не оценить — не у всех шагов известны и время, и темп"
              : ` · ≈ ${formatDuration(durationSec)}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Добавьте разминку, отрезки и заминку кнопками выше.
            </p>
          ) : (
            <ol className="flex flex-col gap-1 text-sm">
              {blocks.map((b, i) => (
                <li key={b.id}>
                  {i + 1}. {describeBlock(b)}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Python для garmin-sync</CardTitle>
          <CardDescription>
            Вызов garminconnect, которым тренировка создаётся в реальном аккаунте —
            пока только текст, отправки в Garmin из этой страницы нет.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs">
            {snippet}
          </pre>
          <div>
            <Button variant="outline" size="sm" onClick={copySnippet}>
              Скопировать
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BlockCard({
  block,
  isFirst,
  isLast,
  onChange,
  onRemove,
  onMove,
  onAddChild,
  onChangeChild,
  onRemoveChild,
}: {
  block: WorkoutBlock;
  isFirst: boolean;
  isLast: boolean;
  onChange: (next: Partial<WorkoutBlock>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddChild: (kind: RepeatChild["kind"]) => void;
  onChangeChild: (childId: string, next: Partial<RepeatChild>) => void;
  onRemoveChild: (childId: string) => void;
}) {
  return (
    <Card size="sm">
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{blockTitle(block.kind)}</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Переместить выше"
            disabled={isFirst}
            onClick={() => onMove(-1)}
          >
            ▲
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Переместить ниже"
            disabled={isLast}
            onClick={() => onMove(1)}
          >
            ▼
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Удалить" onClick={onRemove}>
            ×
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {(block.kind === "warmup" || block.kind === "cooldown" || block.kind === "recovery") && (
          <ConditionFields condition={block.condition} onChange={(condition) => onChange({ condition })} />
        )}

        {block.kind === "interval" && (
          <div className="flex flex-col gap-3">
            <ConditionFields condition={block.condition} onChange={(condition) => onChange({ condition })} />
            <PaceFields pace={block.pace} onChange={(pace) => onChange({ pace })} />
          </div>
        )}

        {block.kind === "repeat" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${block.id}-iterations`}>Повторов</Label>
              <Input
                id={`${block.id}-iterations`}
                type="number"
                min={1}
                className="w-24"
                value={block.iterations}
                onChange={(e) =>
                  onChange({ iterations: Math.max(1, Math.round(Number(e.target.value) || 1)) })
                }
              />
            </div>

            <div className="flex flex-col gap-3 border-l-2 pl-3">
              {block.steps.map((step) => (
                <div key={step.id} className="flex items-start gap-2">
                  <div className="flex flex-1 flex-col gap-2">
                    <ConditionFields
                      condition={step.condition}
                      onChange={(condition) => onChangeChild(step.id, { condition })}
                      timeLabel={step.kind === "recovery" ? "Отдых, сек" : undefined}
                    />
                    {step.kind === "interval" && (
                      <PaceFields pace={step.pace} onChange={(pace) => onChangeChild(step.id, { pace })} />
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Удалить шаг"
                    onClick={() => onRemoveChild(step.id)}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="outline" size="xs" onClick={() => onAddChild("interval")}>
                  + отрезок
                </Button>
                <Button variant="outline" size="xs" onClick={() => onAddChild("recovery")}>
                  + отдых
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function blockTitle(kind: WorkoutBlock["kind"]): string {
  switch (kind) {
    case "warmup":
      return "Разминка";
    case "cooldown":
      return "Заминка";
    case "recovery":
      return "Отдых";
    case "interval":
      return "Отрезок";
    case "repeat":
      return "Повтор";
  }
}

/** Выбор условия окончания шага — время, дистанция или кнопка круга. */
function ConditionFields({
  condition,
  onChange,
  timeLabel = "Длительность, сек",
  distanceLabel = "Дистанция, м",
}: {
  condition: StepCondition;
  onChange: (next: StepCondition) => void;
  timeLabel?: string;
  distanceLabel?: string;
}) {
  const durationId = useId();
  const distanceId = useId();

  return (
    <div className="flex flex-wrap items-end gap-3">
      <ToggleGroup
        variant="outline"
        spacing={0}
        value={[condition.type]}
        onValueChange={(value) => {
          const next = value[0] as StepCondition["type"] | undefined;
          if (!next) return;
          if (next === "time") {
            onChange(timeCondition(condition.type === "time" ? condition.durationSec : 600));
          } else if (next === "distance") {
            onChange(distanceCondition(condition.type === "distance" ? condition.distanceM : 400));
          } else {
            onChange({ type: "lapButton" });
          }
        }}
        aria-label="Условие окончания"
      >
        <ToggleGroupItem value="time">Время</ToggleGroupItem>
        <ToggleGroupItem value="distance">Дистанция</ToggleGroupItem>
        <ToggleGroupItem value="lapButton">Кнопка круга</ToggleGroupItem>
      </ToggleGroup>

      {condition.type === "time" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={durationId}>
            {timeLabel} <span className="font-normal text-muted-foreground">≈ {formatDuration(condition.durationSec)}</span>
          </Label>
          <Input
            id={durationId}
            type="number"
            min={0}
            step={10}
            className="w-32"
            value={condition.durationSec}
            onChange={(e) =>
              onChange(timeCondition(Math.max(0, Math.round(Number(e.target.value) || 0))))
            }
          />
        </div>
      )}

      {condition.type === "distance" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={distanceId}>{distanceLabel}</Label>
          <Input
            id={distanceId}
            type="number"
            min={1}
            className="w-28"
            value={condition.distanceM}
            onChange={(e) =>
              onChange(distanceCondition(Math.max(1, Math.round(Number(e.target.value) || 1))))
            }
          />
        </div>
      )}
    </div>
  );
}

function PaceFields({
  pace,
  onChange,
}: {
  pace: PaceRange | null;
  onChange: (next: PaceRange | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Темп быстрее, /км</Label>
        <Input
          placeholder="4:20"
          className="w-24"
          value={pace?.fast ?? ""}
          onChange={(e) => onChange({ fast: e.target.value, slow: pace?.slow ?? "" })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>медленнее, /км</Label>
        <Input
          placeholder="4:40"
          className="w-24"
          value={pace?.slow ?? ""}
          onChange={(e) => onChange({ fast: pace?.fast ?? "", slow: e.target.value })}
        />
      </div>
      {pace && (pace.fast !== "" || pace.slow !== "") && (
        <Button variant="ghost" size="xs" onClick={() => onChange(null)}>
          Убрать темп
        </Button>
      )}
    </div>
  );
}
