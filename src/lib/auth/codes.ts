import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export const CODE_TTL_MS = 10 * 60 * 1000; // 10 минут
export const MAX_ATTEMPTS = 5;

/** sha256(email:code) — привязка к email, чтобы хеш нельзя было переиспользовать. */
export function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${email}:${code}`).digest("hex");
}

/** Постоянное по времени сравнение hex-строк одинаковой длины. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Генерирует 6-значный код и записывает его хеш. Старые коды email гасятся. */
export async function issueCode(email: string, ip: string | null): Promise<string> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

  // Гасим прежние неиспользованные коли этого email (один активный код на email).
  await db.loginCode.updateMany({
    where: { email, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await db.loginCode.create({
    data: {
      email,
      codeHash: hashCode(email, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      ip,
    },
  });

  return code;
}

type VerifyResult = { ok: true } | { ok: false; reason: "invalid" | "expired" };

/**
 * Проверяет код. Неверный код увеличивает счётчик попыток и гасит код после
 * MAX_ATTEMPTS. Успешный — помечает код использованным.
 */
export async function verifyCode(email: string, code: string): Promise<VerifyResult> {
  const record = await db.loginCode.findFirst({
    where: { email, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return { ok: false, reason: "invalid" };

  if (record.expiresAt.getTime() < Date.now()) {
    await db.loginCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return { ok: false, reason: "expired" };
  }

  const matches = safeEqualHex(record.codeHash, hashCode(email, code));

  if (!matches) {
    const attempts = record.attempts + 1;
    await db.loginCode.update({
      where: { id: record.id },
      // После MAX_ATTEMPTS код сгорает — 6 цифр иначе перебираются.
      data: {
        attempts,
        consumedAt: attempts >= MAX_ATTEMPTS ? new Date() : null,
      },
    });
    return { ok: false, reason: "invalid" };
  }

  await db.loginCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });
  return { ok: true };
}

/** Ленивая уборка протухших кодов — фоновых задач на serverless нет. */
export async function purgeExpiredCodes(): Promise<void> {
  await db.loginCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
