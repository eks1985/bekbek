// Генерация Python-вызова garminconnect из схемы конструктора — именно
// так структурированные тренировки создаются через garminconnect, см.
// garmin-sync/docs/structured-workouts.md. Здесь только текст кода: из
// bek-bek в Garmin пока ничего не отправляется, это следующий шаг после
// прототипа конструктора.
import { parsedPaceRange, type PaceRange, type WorkoutBlock } from "./model";

export function generatePythonSnippet(workoutName: string, blocks: WorkoutBlock[]): string {
  const paceVars: { name: string; fastSecPerKm: number; slowSecPerKm: number }[] = [];

  function paceVarName(pace: PaceRange | null): string | null {
    const parsed = parsedPaceRange(pace);
    if (!parsed) return null;
    const existing = paceVars.find(
      (p) => p.fastSecPerKm === parsed.fastSecPerKm && p.slowSecPerKm === parsed.slowSecPerKm,
    );
    if (existing) return existing.name;
    const name = `pace_${paceVars.length + 1}`;
    paceVars.push({ name, ...parsed });
    return name;
  }

  function intervalCall(distanceM: number, pace: PaceRange | null, order: number): string {
    const varName = paceVarName(pace);
    return varName === null
      ? `create_distance_interval_step(${distanceM}.0, ${order})`
      : `create_targeted_distance_interval_step(${distanceM}.0, ${order}, target=${varName})`;
  }

  const stepLines: string[] = [];
  blocks.forEach((block, i) => {
    const order = i + 1;
    if (block.kind === "warmup") {
      stepLines.push(`create_warmup_step(${block.durationSec}.0),`);
    } else if (block.kind === "cooldown") {
      stepLines.push(`create_cooldown_step(${block.durationSec}.0, ${order}),`);
    } else if (block.kind === "recovery") {
      stepLines.push(`create_recovery_step(${block.durationSec}.0, ${order}),`);
    } else if (block.kind === "interval") {
      stepLines.push(`${intervalCall(block.distanceM, block.pace, order)},`);
    } else {
      const childLines = block.steps.map((s, j) =>
        s.kind === "interval"
          ? intervalCall(s.distanceM, s.pace, j + 1)
          : `create_recovery_step(${s.durationSec}.0, ${j + 1})`,
      );
      stepLines.push(
        `create_repeat_group(${block.iterations}, [\n` +
          childLines.map((l) => `    ${l},`).join("\n") +
          `\n], step_order=${order}),`,
      );
    }
  });

  const paceLines = paceVars.map(
    ({ name, fastSecPerKm, slowSecPerKm }) =>
      `${name} = PaceTarget(lower_limit=pace_to_mps(${minSecArgs(slowSecPerKm)}), upper_limit=pace_to_mps(${minSecArgs(fastSecPerKm)}))`,
  );

  const lines = [
    "# Черновик по garmin-sync/docs/structured-workouts.md — сверьте",
    "# сигнатуры хелперов с установленной версией garminconnect перед запуском.",
    "from garminconnect.workout import (",
    "    RunningWorkout, WorkoutSegment,",
    "    create_warmup_step, create_cooldown_step, create_recovery_step,",
    "    create_distance_interval_step, create_targeted_distance_interval_step,",
    "    create_repeat_group, PaceTarget, pace_to_mps,",
    ")",
    "from app.garmin_client import connect",
    "",
    "api = connect()",
    "",
    ...paceLines,
    ...(paceLines.length > 0 ? [""] : []),
    "workout = RunningWorkout(",
    `    workoutName=${JSON.stringify(workoutName)},`,
    "    workoutSegments=[WorkoutSegment(",
    "        segmentOrder=1,",
    '        sportType={"sportTypeId": 1, "sportTypeKey": "running"},',
    "        workoutSteps=[",
    ...stepLines.flatMap((l) => indent(l, 12)),
    "        ],",
    "    )],",
    ")",
    "",
    "created = api.upload_running_workout(workout)",
  ];

  return lines.join("\n");
}

function minSecArgs(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}, ${secPerKm % 60}`;
}

function indent(text: string, spaces: number): string[] {
  const pad = " ".repeat(spaces);
  return text.split("\n").map((line) => pad + line);
}
