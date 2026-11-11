// Генерация Python-вызова garminconnect из схемы конструктора — именно так
// структурированные тренировки создаются через garminconnect (см.
// garmin-sync/app/workout_builder.py — та же логика, но реально выполняется
// и грузит тренировку в Garmin; этот файл только рисует текст для превью).
import {
  parsedPaceRange,
  totalDurationSec,
  type PaceRange,
  type StepCondition,
  type WorkoutBlock,
} from "./model";

type Role = "warmup" | "cooldown" | "interval" | "recovery";

/** stepTypeId/stepTypeKey по StepType из garminconnect.workout (проверено по
 * исходнику 0.3.20: displayOrder у stepType/endCondition равен самому id). */
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
      if (role === "warmup") return `create_warmup_step(${condition.durationSec}.0, ${order}),`;
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
    // хелперов в библиотеке нет, собираем шаг вручную (create_custom_step).
    needsCustomStep = true;
    const [typeId, typeKey] = ROLE_STEP_TYPE[role];
    const varName = role === "interval" ? paceVarName(pace) : null;
    const targetArg = varName === null ? "" : `, target=${varName}`;
    if (condition.type === "distance") {
      return (
        `create_custom_step(${typeId}, ${JSON.stringify(typeKey)}, ConditionType.DISTANCE, ` +
        `"distance", ${condition.distanceM}.0, ${order}${targetArg}),`
      );
    }
    return (
      `create_custom_step(${typeId}, ${JSON.stringify(typeKey)}, ConditionType.LAP_BUTTON, ` +
      `"lap.button", None, ${order}${targetArg}),`
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

  const estimatedSec = Math.round(totalDurationSec(blocks) ?? 0);

  const lines = [
    "# Соответствует app/workout_builder.py — тот же код реально выполняется",
    "# на стороне garmin-sync при отправке тренировки.",
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
    `    estimatedDurationInSecs=${estimatedSec},`,
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
    "# displayOrder равен самому id типа — так устроены все штатные хелперы",
    "# библиотеки (проверено по исходнику 0.3.20, см. app/workout_builder.py).",
    "def create_custom_step(step_type_id, step_type_key, condition_type_id, condition_type_key,",
    "                        end_condition_value, order, target=None):",
    "    target_type = (",
    '        {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone", "displayOrder": 1}',
    "        if target is not None",
    '        else {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}',
    "    )",
    "    return ExecutableStep(",
    "        stepOrder=order,",
    '        stepType={"stepTypeId": step_type_id, "stepTypeKey": step_type_key, "displayOrder": step_type_id},',
    "        endCondition={",
    '            "conditionTypeId": condition_type_id,',
    '            "conditionTypeKey": condition_type_key,',
    '            "displayOrder": condition_type_id,',
    '            "displayable": True,',
    "        },",
    "        endConditionValue=end_condition_value,",
    "        targetType=target_type,",
    "        targetValueOne=target.lower_limit if target is not None else None,",
    "        targetValueTwo=target.upper_limit if target is not None else None,",
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
