import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseWorkout } from "@/lib/fit";
import { workoutRow } from "@/lib/workouts/to-row";
import { deleteObject, putObject } from "@/lib/storage/s3";

export const MAX_FIT_SIZE_BYTES = 10 * 1024 * 1024;

export type UploadedFitFile = {
  id: string;
  originalName: string;
  sizeBytes: number;
  uploadedAt: Date;
  /** Итог разбора; null — разобрать не удалось, см. parseError. */
  workout: { startTime: Date; distanceM: number | null; workoutTag: string | null } | null;
  /** Почему разбор не получился (файл при этом сохранён). */
  parseError?: string;
};

export type UploadResult =
  | { ok: true; file: UploadedFitFile }
  | { ok: false; status: 400 | 409; error: string };

/** Заголовок FIT: байты 8–11 — ASCII ".FIT". */
function isFitFile(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[8] === 0x2e && // .
    bytes[9] === 0x46 && // F
    bytes[10] === 0x49 && // I
    bytes[11] === 0x54 // T
  );
}

/**
 * Кладёт FIT-файл в бакет (fit/<userId>/<id>.fit) и пишет строку fit_files.
 * Не зависит от транспорта — вызывается из route handler, потом может и из экшена.
 */
export async function uploadFitFile(
  userId: string,
  file: File,
): Promise<UploadResult> {
  const originalName = file.name.slice(0, 255) || "file.fit";

  if (!originalName.toLowerCase().endsWith(".fit")) {
    return { ok: false, status: 400, error: "Нужен файл с расширением .fit" };
  }
  if (file.size === 0) {
    return { ok: false, status: 400, error: "Файл пустой" };
  }
  if (file.size > MAX_FIT_SIZE_BYTES) {
    return { ok: false, status: 400, error: "Файл больше 10 МБ" };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isFitFile(bytes)) {
    return { ok: false, status: 400, error: "Это не FIT-файл" };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const duplicate = await db.fitFile.findUnique({
    where: { userId_sha256: { userId, sha256 } },
    select: { id: true },
  });
  if (duplicate) {
    return { ok: false, status: 409, error: "Этот файл уже загружен" };
  }

  const id = randomUUID();
  const storageKey = `fit/${userId}/${id}.fit`;

  await putObject(storageKey, bytes, "application/vnd.ant.fit");

  // Разбираем сразу, как в консоли: --workout auto (допуск и разминка — по
  // умолчанию). Если файл не поддался, он всё равно остаётся в бакете:
  // парсер меняется, разбор можно будет повторить.
  let workout: ReturnType<typeof workoutRow> | null = null;
  let parseError: string | undefined;
  try {
    workout = workoutRow(parseWorkout(bytes, { fileName: originalName, workout: "auto" }));
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
    console.error(`Не удалось разобрать ${originalName}:`, err);
  }

  try {
    const row = await db.fitFile.create({
      data: {
        id,
        userId,
        storageKey,
        originalName,
        sizeBytes: bytes.length,
        sha256,
        ...(workout ? { workout: { create: { userId, ...workout } } } : {}),
      },
      select: {
        id: true,
        originalName: true,
        sizeBytes: true,
        uploadedAt: true,
        workout: { select: { startTime: true, distanceM: true, workoutTag: true } },
      },
    });
    return { ok: true, file: { ...row, parseError } };
  } catch (err) {
    // Запись в БД не прошла — убираем объект, чтобы не оставлять сирот.
    await deleteObject(storageKey).catch(() => {});
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Тот же файл параллельно загрузили вторым запросом.
      return { ok: false, status: 409, error: "Этот файл уже загружен" };
    }
    throw err;
  }
}
