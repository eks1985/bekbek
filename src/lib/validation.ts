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
