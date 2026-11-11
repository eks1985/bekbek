# Структурированные тренировки через garminconnect — заметки для реализации

Статус: исследование, реализация позже. Проверено 2026-11-10 по исходнику
wheel `garminconnect==0.3.20` с PyPI (ровно наша версия из `requirements.txt`),
плюс примеры JSON из чужих разборов внутреннего API Garmin (ссылки внизу).

Итог: **создавать структурированные тренировки библиотека умеет** — типизированными
моделями (pydantic) или сырым JSON. До реализации: добавить в `requirements.txt`
extra `garminconnect[workout]` (подтянет `pydantic>=2.4`) и проверить на живом
аккаунте на VPS (с ПК вход в Garmin не работает, см. README).

## Методы клиента (`garminconnect/api/workouts.py`, все есть в 0.3.20)

Создание и изменение:

- `upload_workout(workout_json)` — сырой JSON (формат внутреннего API Garmin);
- `upload_running_workout(workout)` / `upload_cycling_workout` /
  `upload_swimming_workout` / `upload_strength_workout` — принимают
  типизированные модели из `garminconnect.workout`;
- `update_workout(workout_id, workout_json)` — PUT, **полная замена** структуры
  с сохранением id;
- `copy_workout(workout_id, name)`, `delete_workout(workout_id)`.

Чтение:

- `get_workouts(start, limit, ...)` — список, `get_workout_by_id(id)` — эталонный
  JSON тренировки;
- `get_workout_count()`, `get_workout_sport_types()`, `get_workout_types()`;
- `download_workout(workout_id)` — тренировка готовым .fit (интересно и для
  bek-bek: так можно конвертировать схему в FIT без своего генератора).

Календарь:

- `schedule_workout(workout_id, "2026-11-12")` — дата в календарь Connect;
- `reschedule_workout`, `unschedule_workout`, `get_scheduled_workouts(year, month)`,
  `get_scheduled_workouts_by_period(start, end)`, `get_next_scheduled_workout()`.

На часы тренировка попадает при следующей синхронизации устройства; отдельного
«push на часы» в 0.3.20 нет.

## Модели (`garminconnect/workout.py`)

Классы тренировок: `RunningWorkout`, `CyclingWorkout`, `SwimmingWorkout`,
`StrengthWorkout`, `MultiSportWorkout` (+ `WalkingWorkout`, `HikingWorkout`,
`FitnessEquipmentWorkout` — но `upload_walking_workout`/`upload_hiking_workout`
всегда бросают исключение: у Garmin нет такого sport type для тренировок).

Строительные блоки: `WorkoutSegment` (сегмент со sportType), `ExecutableStep`
(шаг; pydantic-модель с `extra="allow"` — можно подсунуть любое поле Garmin),
`RepeatGroup` (повтор).

Хелперы шагов:

- по времени: `create_warmup_step(seconds)`, `create_interval_step(seconds, ...)`,
  `create_recovery_step(seconds, order)`, `create_cooldown_step(seconds, order)`;
- по дистанции: `create_distance_interval_step(meters, ...)`,
  `create_targeted_distance_interval_step(meters, order, target=...)`;
- с целью: `create_targeted_interval_step(seconds, order, target=...)`;
- повтор: `create_repeat_group(iterations, [steps], step_order=, skip_last_rest_step=)`.

Разминка/восстановление/заминка — **только по времени**; «отдых 200 м» —
дистанционным interval-шагом.

Цели (`target=`): `PaceTarget`, `HeartRateZoneTarget`, `CustomHeartRateTarget`,
`PowerZoneTarget`, `CustomPowerTarget`, `CadenceTarget`, `SpeedTarget`,
`SwimCssOffsetTarget` (вторичная для плавания). Диапазонные цели —
`lower_limit`/`upper_limit`; в `PaceTarget` они в м/с, **медленный темп — lower**:
`PaceTarget(lower_limit=pace_to_mps(4, 40), upper_limit=pace_to_mps(4, 20))`.
Хелперы: `pace_to_mps(мин, сек, "km")`, `speed_to_mps(число, "kph")`.

Константы: `StepType` (WARMUP=1, COOLDOWN=2, INTERVAL=3, RECOVERY=4, REST=5,
REPEAT=6), `ConditionType` (LAP_BUTTON=1, TIME=2, DISTANCE=3, CALORIES=4, POWER=5,
HEART_RATE=6, ITERATIONS=7), `TargetType` (PACE_ZONE=6, ...).

## Пример (шаг по нажатию круга — см. следующий раздел)

```python
from garminconnect.workout import (
    RunningWorkout, WorkoutSegment,
    create_warmup_step, create_cooldown_step, create_recovery_step,
    create_targeted_distance_interval_step, create_repeat_group,
    PaceTarget, pace_to_mps,
)
from app.garmin_client import connect

api = connect()

pace = PaceTarget(lower_limit=pace_to_mps(4, 40), upper_limit=pace_to_mps(4, 20))

workout = RunningWorkout(
    workoutName="6 × 400 м",
    estimatedDurationInSecs=2700,
    workoutSegments=[WorkoutSegment(
        segmentOrder=1,
        sportType={"sportTypeId": 1, "sportTypeKey": "running"},
        workoutSteps=[
            create_warmup_step(600.0),                        # 10 мин разминки
            create_repeat_group(6, [
                create_targeted_distance_interval_step(400.0, 1, target=pace),
                create_recovery_step(90.0, 2),                # отдых — только по времени
            ], step_order=2),
            create_cooldown_step(600.0, 3),
        ],
    )],
)

created = api.upload_running_workout(workout)
api.schedule_workout(created["workoutId"], "2026-11-12")      # опционально — в календарь
```

## Шаг с завершением по нажатию lap button

Хелперов для этого нет (они зашивают time/distance), но `ConditionType.LAP_BUTTON
= 1` в библиотеке есть, и шаг собирается вручную. Формат — ровно то, что шлёт
веб-интерфейс Garmin Connect («Нажатие кнопки круга»): `conditionTypeId: 1`,
`conditionTypeKey: "lap.button"`, `endConditionValue: null`.

```python
from garminconnect.workout import ExecutableStep, StepType, ConditionType

def create_lap_button_step(step_type_id: int, step_type_key: str,
                           step_order: int) -> ExecutableStep:
    """Шаг, который заканчивается нажатием кнопки круга."""
    return ExecutableStep(
        stepOrder=step_order,
        stepType={
            "stepTypeId": step_type_id,          # StepType.WARMUP / RECOVERY / ...
            "stepTypeKey": step_type_key,        # "warmup" / "recovery" / ...
            "displayOrder": 1,
        },
        endCondition={
            "conditionTypeId": ConditionType.LAP_BUTTON,   # 1
            "conditionTypeKey": "lap.button",
            "displayOrder": 1,
            "displayable": True,
        },
        endConditionValue=None,                  # у lap-шага значения нет
    )

# использование: create_lap_button_step(StepType.WARMUP, "warmup", 1) и т.п.
```

## Подводные камни

- API неофициальный (внутренний web-API Garmin Connect); формат может меняться
  между релизами — поэтому версию в `requirements.txt` держим точной.
- `update_workout` — замена целиком: слать полную структуру (как из
  `get_workout_by_id`), а не патч.
- Тренировка появляется в Connect → Тренировки и уходит на часы при следующей
  синхронизации; «push на устройство» в 0.3.20 отсутствует.
- Ходьба и хайкинг как типы тренировок не существуют — методы есть, но всегда
  бросают исключение.
- Лучшая проверка принятого JSON: `get_workout_by_id` после загрузки и
  сверка endCondition/targetType с эталоном. Эталон удобно получить один раз:
  собрать тренировку с lap-шагом вручную в веб-UI Connect и выгрузить её тем же
  `get_workout_by_id`.

## Идея для bek-bek

Это обратная задача к парсеру: из схемы отрезков вида `-200-400-600-400-200-`
можно генерировать структурированные тренировки (шаги по дистанции +
repeat-группы + темп из зоны), а `download_workout` умеет отдавать итог .fit.

## Ссылки

- python-garminconnect: https://github.com/cyberjunky/python-garminconnect
- Расширение про создание/календарь: discussion #302, issue #290 в том же репо.
- Сырой JSON шага lap.button: https://github.com/sesh/fitlek/issues/1
- Коды end-condition: https://glama.ai/mcp/servers/jaounial/garmin_mcp
