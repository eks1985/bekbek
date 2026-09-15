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
