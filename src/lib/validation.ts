import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

// Код — ровно 6 цифр.
export const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Код состоит из 6 цифр");

export const requestCodeSchema = z.object({
  email: emailSchema,
});

export const verifySchema = z.object({
  email: emailSchema,
  code: codeSchema,
});

// Повторный разбор: своя схема либо параметры режима auto.
// Границы те же, что у флагов CLI (--tolerance, --warmup).
export const reparseSchema = z.object({
  pattern: z.string().trim().max(200).optional(),
  tolerancePct: z.number().gt(0).lt(50).optional(),
  warmupLaps: z.number().int().min(0).max(50).optional(),
});

// Структурированная тренировка из конструктора — та же форма, что
// src/lib/structured-workouts/model.ts (WorkoutBlock[]), без поля id (оно
// нужно только React-ключам в UI, backend его не использует).
const paceRangeSchema = z.object({ fast: z.string(), slow: z.string() });

const stepConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("time"), durationSec: z.number().min(0) }),
  z.object({ type: z.literal("distance"), distanceM: z.number().min(0) }),
  z.object({ type: z.literal("lapButton") }),
]);

const repeatChildSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("interval"),
    condition: stepConditionSchema,
    pace: paceRangeSchema.nullable(),
  }),
  z.object({ kind: z.literal("recovery"), condition: stepConditionSchema }),
]);

const workoutBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("warmup"), condition: stepConditionSchema }),
  z.object({ kind: z.literal("cooldown"), condition: stepConditionSchema }),
  z.object({
    kind: z.literal("interval"),
    condition: stepConditionSchema,
    pace: paceRangeSchema.nullable(),
  }),
  z.object({ kind: z.literal("recovery"), condition: stepConditionSchema }),
  z.object({
    kind: z.literal("repeat"),
    iterations: z.number().int().min(1).max(100),
    steps: z.array(repeatChildSchema).min(1).max(50),
  }),
]);

export const createWorkoutSchema = z.object({
  workoutName: z.string().trim().min(1).max(100),
  blocks: z.array(workoutBlockSchema).min(1).max(100),
});
