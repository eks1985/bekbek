import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

// Вход по секретному коду — временная замена коду из письма, пока не работает
// почта. Код один на всех (ADMIN_CODE): кто его знает, входит под любым email.
// Email при этом ничем не подтверждается — он лишь задаёт, чьи тренировки
// откроются. Убрать ADMIN_CODE из env — и вернётся вход по коду из письма.

/** Задан ли ADMIN_CODE. Сам код не отдаёт, поэтому можно звать для клиента. */
export function adminCodeEnabled(): boolean {
  return Boolean(process.env.ADMIN_CODE?.trim());
}

/** Введён ли секретный код. ADMIN_CODE не задан — всегда false. */
export function isAdminCode(code: string): boolean {
  const expected = process.env.ADMIN_CODE?.trim();
  if (!expected) return false;
  // Сравнение без утечки по времени; хеши выравнивают длину.
  return timingSafeEqual(sha256(code), sha256(expected));
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
