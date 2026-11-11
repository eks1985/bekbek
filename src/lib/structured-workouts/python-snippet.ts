// Генерация Python-вызова garminconnect из схемы конструктора — именно
// так структурированные тренировки создаются через garminconnect, см.
// garmin-sync/docs/structured-workouts.md. Здесь только текст кода: из
// bek-bek в Garmin пока ничего не отправляется, это следующий шаг после
// прототипа конструктора.
import { parsedPaceRange, type PaceRange, type StepCondition, type WorkoutBlock } from "./model";

type Role = "warmup" | "cooldown" | "interval" | "recovery";

/** stepTypeId/stepTypeKey по StepType из доки (WARMUP=1 … RECOVERY=4). */
const ROLE_STEP_TYPE: Record<Role, [number, string]> = {
  warmup: [1, "warmup"],
  cooldown: [2, "cooldown"],
  interval: [3, "interval"],
  recovery: [4, "recovery"],
};

export function generatePythonSnippet(workoutName: string, blocks: WorkoutBlock[]): string {
  const paceVars: { name: string; fastSecPerKm: number; slowSecPerKm: number }[] = [];
  let needsCustomStep = false;

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

  /**
   * По роли и условию окончания — именованный хелпер, если он есть в
   * библиотеке (время у warmup/cooldown/recovery, время и дистанция у
   * interval), иначе ручная сборка шага (create_custom_step).
   */
  function stepCall(role: Role, condition: StepCondition, pace: PaceRange | null, order: number): string {
    if (condition.type === "time") {
      if (role === "warmup") return `create_warmup_step(${condition.durationSec}.0),`;
      if (role === "cooldown") return `create_cooldown_step(${condition.durationSec}.0, ${order}),`;
      if (role === "recovery") return `create_recovery_step(${condition.durationSec}.0, ${order}),`;
      const varName = paceVarName(pace);
      return varName === null
        ? `create_interval_step(${condition.durationSec}.0, ${order}),`
        : `create_targeted_interval_step(${condition.durationSec}.0, ${order}, target=${varName}),`;
    }

    if (condition.type === "distance" && role === "interval") {
      const varName = paceVarName(pace);
      return varName === null
        ? `create_distance_interval_step(${condition.distanceM}.0, ${order}),`
        : `create_targeted_distance_interval_step(${condition.distanceM}.0, ${order}, target=${varName}),`;
    }

    // Дистанция у warmup/cooldown/recovery и кнопка круга у любой роли —
    // хелперов нет, собираем шаг вручную (формат — как у lap.button в доке).
    needsCustomStep = true;
    const [typeId, typeKey] = ROLE_STEP_TYPE[role];
    if (condition.type === "distance") {
      return (
        `create_custom_step(${typeId}, ${JSON.stringify(typeKey)}, ConditionType.DISTANCE, ` +
        `"distance.distance", ${condition.distanceM}.0, ${order}),  ` +
        `# ключ условия — гипотеза, см. комментарий у create_custom_step`
      );
    }
    const paceNote = role === "interval" && pace ? "  # цель по темпу не поддержана при кнопке круга" : "";
    return (
      `create_custom_step(${typeId}, ${JSON.stringify(typeKey)}, ConditionType.LAP_BUTTON, ` +
      `"lap.button", None, ${order}),${paceNote}`
    );
  }

  const stepLines: string[] = [];
  blocks.forEach((block, i) => {
    const order = i + 1;
    if (block.kind === "repeat") {
      const childLines = block.steps.map((s, j) =>
        stepCall(s.kind, s.condition, s.kind === "interval" ? s.pace : null, j + 1),
      );
      stepLines.push(
        `create_repeat_group(${block.iterations}, [\n` +
          childLines.map((l) => `    ${l}`).join("\n") +
          `\n], step_order=${order}),`,
      );
    } else {
      stepLines.push(stepCall(block.kind, block.condition, block.kind === "interval" ? block.pace : null, order));
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
    "    create_interval_step, create_targeted_interval_step,",
    "    create_distance_interval_step, create_targeted_distance_interval_step,",
    "    create_repeat_group, PaceTarget, pace_to_mps,",
    ...(needsCustomStep ? ["    ExecutableStep, ConditionType,"] : []),
    ")",
    "from app.garmin_client import connect",
    "",
    "api = connect()",
    "",
    ...paceLines,
    ...(paceLines.length > 0 ? [""] : []),
    ...customStepDef(needsCustomStep),
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

function customStepDef(needed: boolean): string[] {
  if (!needed) return [];
  return [
    "# Условие «по дистанции» у разминки/отдыха/заминки и «по кнопке круга» у",
    "# любого шага — готовых хелперов для них нет, шаг собирается вручную.",
    '# Формат для "lap.button" подтверждён в доке; "distance.distance" ниже —',
    "# рабочая гипотеза по аналогии, сверьте через get_workout_by_id перед",
    "# реальной отправкой.",
    "def create_custom_step(step_type_id, step_type_key, condition_type_id, condition_type_key,",
    "                        end_condition_value, order):",
    "    return ExecutableStep(",
    "        stepOrder=order,",
    '        stepType={"stepTypeId": step_type_id, "stepTypeKey": step_type_key, "displayOrder": 1},',
    "        endCondition={",
    '            "conditionTypeId": condition_type_id,',
    '            "conditionTypeKey": condition_type_key,',
    '            "displayOrder": 1,',
    '            "displayable": True,',
    "        },",
    "        endConditionValue=end_condition_value,",
    "    )",
    "",
  ];
}

function minSecArgs(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}, ${secPerKm % 60}`;
}

function indent(text: string, spaces: number): string[] {
  const pad = " ".repeat(spaces);
  return text.split("\n").map((line) => pad + line);
}
