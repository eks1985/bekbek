import { db } from "@/lib/db";

// Rate-limit хранится в БД, а не в памяти процесса: на serverless инстансов
// может быть несколько, и счётчик в памяти каждый видит только свой.

const WINDOW_MS = 15 * 60 * 1000; // окно 15 минут

type Limit = { bucket: string; key: string; max: number };

/**
 * Регистрирует обращение и возвращает false, если лимит по этому ключу за окно
 * уже превышен. Заодно чистит устаревшие записи бакета.
 */
async function hit({ bucket, key, max }: Limit): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);

  await db.rateHit.deleteMany({
    where: { bucket, createdAt: { lt: since } },
  });

  const count = await db.rateHit.count({
    where: { bucket, key, createdAt: { gte: since } },
  });

  if (count >= max) return false;

  await db.rateHit.create({ data: { bucket, key } });
  return true;
}

/**
 * Лимиты на запрос кода: не более 3 на один email и 10 на один IP за 15 минут.
 * Возвращает true, если запрос разрешён.
 */
export async function allowRequestCode(
  email: string,
  ip: string | null,
): Promise<boolean> {
  const okEmail = await hit({
    bucket: "request-code:email",
    key: email,
    max: 3,
  });
  if (!okEmail) return false;

  if (ip) {
    const okIp = await hit({ bucket: "request-code:ip", key: ip, max: 10 });
    if (!okIp) return false;
  }

  return true;
}
