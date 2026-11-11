"""Собирает и грузит в Garmin структурированную тренировку (бег) из JSON-схемы
конструктора bek-bek (та же модель, что в src/lib/structured-workouts/model.ts —
см. также её генератор Python-кода python-snippet.ts, который показывает
пользователю предпросмотр этого же вызова).

У каждого шага — условие окончания: время, дистанция или кнопка круга. Время у
warmup/cooldown/interval/recovery и дистанция у interval — через штатные
хелперы garminconnect.workout. Дистанция у warmup/cooldown/recovery и кнопка
круга у любой роли — хелперов для них в библиотеке нет, шаг собирается вручную
(create_custom_step): displayOrder у stepType/endCondition равен самому id
типа — так устроены все штатные хелперы (проверено по исходнику 0.3.20,
garminconnect/workout.py), а не угадано.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from garminconnect import Garmin
from garminconnect.workout import (
    ConditionType,
    ExecutableStep,
    PaceTarget,
    RepeatGroup,
    RunningWorkout,
    StepType,
    TargetType,
    WorkoutSegment,
    create_cooldown_step,
    create_distance_interval_step,
    create_interval_step,
    create_recovery_step,
    create_repeat_group,
    create_targeted_distance_interval_step,
    create_targeted_interval_step,
    create_warmup_step,
    pace_to_mps,
)

Role = Literal["warmup", "cooldown", "interval", "recovery"]

_ROLE_STEP_TYPE: dict[Role, tuple[int, str]] = {
    "warmup": (StepType.WARMUP, "warmup"),
    "cooldown": (StepType.COOLDOWN, "cooldown"),
    "interval": (StepType.INTERVAL, "interval"),
    "recovery": (StepType.RECOVERY, "recovery"),
}

_PACE_RE = re.compile(r"^(\d{1,2}):([0-5]?\d)$")


def _parse_pace_input(text: str) -> int | None:
    """"4:30" -> 270 секунд на км — как parsePaceInput в model.ts."""
    m = _PACE_RE.match(text.strip())
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def _pace_target(pace: dict[str, Any] | None) -> PaceTarget | None:
    """Границы без учёта порядка ввода — как parsedPaceRange в model.ts:
    быстрее (меньше сек/км) всегда upper_limit по скорости, медленнее — lower."""
    if not pace:
        return None
    a = _parse_pace_input(pace.get("fast", ""))
    b = _parse_pace_input(pace.get("slow", ""))
    if a is None or b is None:
        return None
    fast_sec_per_km, slow_sec_per_km = min(a, b), max(a, b)
    return PaceTarget(
        lower_limit=pace_to_mps(slow_sec_per_km // 60, slow_sec_per_km % 60, "km"),
        upper_limit=pace_to_mps(fast_sec_per_km // 60, fast_sec_per_km % 60, "km"),
    )


def _step_distance_m(condition: dict[str, Any], pace: dict[str, Any] | None) -> float:
    if condition["type"] == "distance":
        return float(condition["distanceM"])
    if condition["type"] == "time":
        target = _pace_target(pace)
        if target is None:
            return 0.0
        mid_mps = (target.lower_limit + target.upper_limit) / 2
        return condition["durationSec"] * mid_mps
    return 0.0


def _step_duration_sec(condition: dict[str, Any], pace: dict[str, Any] | None) -> float | None:
    if condition["type"] == "time":
        return float(condition["durationSec"])
    if condition["type"] == "lapButton":
        return None
    target = _pace_target(pace)
    if target is None:
        return None
    mid_mps = (target.lower_limit + target.upper_limit) / 2
    return condition["distanceM"] / mid_mps


def create_custom_step(
    step_type_id: int,
    step_type_key: str,
    condition_type_id: int,
    condition_type_key: str,
    end_condition_value: float | None,
    order: int,
    target: PaceTarget | None = None,
) -> ExecutableStep:
    """Шаг без готового хелпера в garminconnect (дистанция у
    warmup/cooldown/recovery, кнопка круга у любой роли). displayOrder у
    stepType/endCondition равен самому id типа — так устроены все штатные
    хелперы библиотеки, см. docstring модуля."""
    target_type = (
        {
            "workoutTargetTypeId": TargetType.PACE_ZONE,
            "workoutTargetTypeKey": "pace.zone",
            "displayOrder": 1,
        }
        if target is not None
        else {
            "workoutTargetTypeId": TargetType.NO_TARGET,
            "workoutTargetTypeKey": "no.target",
            "displayOrder": 1,
        }
    )
    return ExecutableStep(
        stepOrder=order,
        stepType={
            "stepTypeId": step_type_id,
            "stepTypeKey": step_type_key,
            "displayOrder": step_type_id,
        },
        endCondition={
            "conditionTypeId": condition_type_id,
            "conditionTypeKey": condition_type_key,
            "displayOrder": condition_type_id,
            "displayable": True,
        },
        endConditionValue=end_condition_value,
        targetType=target_type,
        targetValueOne=target.lower_limit if target is not None else None,
        targetValueTwo=target.upper_limit if target is not None else None,
    )


def _build_step(
    role: Role, condition: dict[str, Any], pace: dict[str, Any] | None, order: int
) -> ExecutableStep:
    ctype = condition["type"]

    if ctype == "time":
        sec = float(condition["durationSec"])
        if role == "warmup":
            return create_warmup_step(sec, order)
        if role == "cooldown":
            return create_cooldown_step(sec, order)
        if role == "recovery":
            return create_recovery_step(sec, order)
        target = _pace_target(pace)
        return (
            create_interval_step(sec, order)
            if target is None
            else create_targeted_interval_step(sec, order, target=target)
        )

    if ctype == "distance" and role == "interval":
        meters = float(condition["distanceM"])
        target = _pace_target(pace)
        return (
            create_distance_interval_step(meters, order)
            if target is None
            else create_targeted_distance_interval_step(meters, order, target=target)
        )

    step_type_id, step_type_key = _ROLE_STEP_TYPE[role]
    if ctype == "distance":
        return create_custom_step(
            step_type_id,
            step_type_key,
            ConditionType.DISTANCE,
            "distance",
            float(condition["distanceM"]),
            order,
        )
    # lapButton — пользователь завершает шаг нажатием кнопки на часах.
    target = _pace_target(pace) if role == "interval" else None
    return create_custom_step(
        step_type_id,
        step_type_key,
        ConditionType.LAP_BUTTON,
        "lap.button",
        None,
        order,
        target=target,
    )


def _build_block(block: dict[str, Any], order: int) -> ExecutableStep | RepeatGroup:
    if block["kind"] == "repeat":
        steps = [
            _build_step(s["kind"], s["condition"], s.get("pace"), i + 1)
            for i, s in enumerate(block["steps"])
        ]
        return create_repeat_group(int(block["iterations"]), steps, order)
    return _build_step(block["kind"], block["condition"], block.get("pace"), order)


def _total_duration_sec(blocks: list[dict[str, Any]]) -> float | None:
    """null (None), если хоть один шаг не оценить (кнопка круга и т.п.) —
    используется только для estimatedDurationInSecs, не критично для Garmin."""
    total = 0.0
    for b in blocks:
        if b["kind"] == "repeat":
            per_round = 0.0
            for s in b["steps"]:
                d = _step_duration_sec(s["condition"], s.get("pace"))
                if d is None:
                    return None
                per_round += d
            total += per_round * int(b["iterations"])
        else:
            d = _step_duration_sec(b["condition"], b.get("pace"))
            if d is None:
                return None
            total += d
    return total


def build_workout(workout_name: str, blocks: list[dict[str, Any]]) -> RunningWorkout:
    steps = [_build_block(b, i + 1) for i, b in enumerate(blocks)]
    duration = _total_duration_sec(blocks)
    return RunningWorkout(
        workoutName=workout_name,
        estimatedDurationInSecs=round(duration) if duration is not None else 0,
        workoutSegments=[
            WorkoutSegment(
                segmentOrder=1,
                sportType={"sportTypeId": 1, "sportTypeKey": "running"},
                workoutSteps=steps,
            )
        ],
    )


def build_and_upload(api: Garmin, workout_name: str, blocks: list[dict[str, Any]]) -> dict[str, Any]:
    workout = build_workout(workout_name, blocks)
    return api.upload_running_workout(workout)
