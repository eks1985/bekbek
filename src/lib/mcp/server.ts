import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { getFitFile, listFitFiles } from "@/lib/fit-files/queries";
import { reparseFitFile } from "@/lib/fit-files/reparse";
import { allowReparse } from "@/lib/rate-limit";
import { reparseSchema } from "@/lib/validation";
import { readStoredWorkout } from "@/lib/workouts/stored";
import { PATTERN_EXAMPLE } from "@/lib/fit";

// MCP-сервер приложения. Создаётся на каждый запрос (stateless, под serverless)
// и уже привязан к пользователю: userId в инструменты приходит отсюда, а не из
// аргументов модели — чужие данные не запросить даже по прямому id.

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const workoutListSelect = {
  id: true,
  fitFileId: true,
  title: true,
  startTime: true,
  sport: true,
  distanceM: true,
  durationSec: true,
  avgPaceSecPerKm: true,
  avgHeartRate: true,
  workoutTag: true,
} satisfies Prisma.WorkoutSelect;

export function createMcpServer(user: SessionUser): McpServer {
  const server = new McpServer({ name: "bek-bek", version: "0.1.0" });

  server.registerTool(
    "whoami",
    {
      title: "Текущий пользователь",
      description: "Чьи данные видит этот MCP-сервер.",
      annotations: { readOnlyHint: true },
    },
    async () => json(user),
  );

  server.registerTool(
    "list_workouts",
    {
      title: "Список тренировок",
      description:
        "Разобранные тренировки пользователя, новые сверху. Дистанция в метрах, " +
        "длительность в секундах, темп — секунды на км. fitFileId — id для get_workout " +
        "и reparse_workout.",
      inputSchema: {
        from: z.string().date().optional().describe("С даты включительно, YYYY-MM-DD (UTC)"),
        to: z.string().date().optional().describe("По дату включительно, YYYY-MM-DD (UTC)"),
        sport: z.string().max(50).optional().describe("Вид спорта из FIT, напр. running"),
        tag: z.string().max(200).optional().describe("Подстрока схемы интервалов, напр. 400"),
        minDistanceM: z.number().min(0).optional(),
        maxDistanceM: z.number().min(0).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ from, to, sport, tag, minDistanceM, maxDistanceM, limit }) => {
      const where: Prisma.WorkoutWhereInput = { userId: user.id };
      if (from || to) {
        where.startTime = {
          ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
          ...(to ? { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
        };
      }
      if (sport) where.sport = sport;
      if (tag) where.workoutTag = { contains: tag };
      if (minDistanceM !== undefined || maxDistanceM !== undefined) {
        where.distanceM = {
          ...(minDistanceM !== undefined ? { gte: minDistanceM } : {}),
          ...(maxDistanceM !== undefined ? { lte: maxDistanceM } : {}),
        };
      }

      const workouts = await db.workout.findMany({
        where,
        orderBy: { startTime: "desc" },
        take: limit,
        select: workoutListSelect,
      });
      return json({ count: workouts.length, workouts });
    },
  );

  server.registerTool(
    "list_fit_files",
    {
      title: "Загруженные FIT-файлы",
      description:
        "Все загруженные файлы, включая те, что не удалось разобрать (workout: null).",
      annotations: { readOnlyHint: true },
    },
    async () => json(await listFitFiles(user.id)),
  );

  server.registerTool(
    "get_workout",
    {
      title: "Тренировка целиком",
      description:
        "Одна тренировка: итоги (summary), схема интервалов (workout), все круги (laps), " +
        "сплиты по км (kmSplits), устройство (source). Посекундных точек нет.",
      inputSchema: {
        fitFileId: z.string().min(1).max(100).describe("fitFileId из list_workouts"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ fitFileId }) => {
      const file = await getFitFile(user.id, fitFileId);
      if (!file) return fail("Файл не найден");

      const { workout } = file;
      return json({
        fitFileId: file.id,
        originalName: file.originalName,
        uploadedAt: file.uploadedAt,
        workout: workout
          ? {
              id: workout.id,
              title: workout.title,
              parserVersion: workout.parserVersion,
              ...readStoredWorkout(workout.data),
            }
          : null,
      });
    },
  );

  server.registerTool(
    "reparse_workout",
    {
      title: "Разобрать заново",
      description:
        "Пересчитывает тренировку из исходного FIT-файла. Без pattern — авто-поиск схемы " +
        "(tolerancePct, warmupLaps). С pattern — своя схема рабочих отрезков, " +
        `например "${PATTERN_EXAMPLE}"; допуск и разминка тогда не применяются. ` +
        "Перезаписывает результат разбора (название тренировки сохраняется).",
      inputSchema: {
        fitFileId: z.string().min(1).max(100),
        pattern: reparseSchema.shape.pattern,
        tolerancePct: reparseSchema.shape.tolerancePct.describe("Допуск, % (по умолчанию 5)"),
        warmupLaps: reparseSchema.shape.warmupLaps.describe("Кругов разминки (по умолчанию 1)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ fitFileId, ...options }) => {
      if (!(await allowReparse(user.id))) {
        return fail("Слишком много разборов подряд. Подождите немного.");
      }
      const result = await reparseFitFile(user.id, fitFileId, options);
      return result.ok ? json(result.workout) : fail(result.error);
    },
  );

  return server;
}
