import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from "./cookies";

const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const ROLLING_THRESHOLD_MS = 24 * 60 * 60 * 1000; // продлеваем не чаще раза в сутки

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Создаёт сессию для пользователя и ставит cookie. Токен генерируется заново
 * при каждом входе (в БД хранится только его sha256), поэтому session fixation
 * не грозит.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();

  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
      ip: (h.get("x-forwarded-for")?.split(",")[0].trim() || null),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export type SessionUser = { id: string; email: string };

/**
 * Возвращает пользователя текущей сессии или null. Rolling-продление: если
 * сессия «свежая» дольше суток, двигаем срок жизни вперёд — активный
 * пользователь не вылетает ровно через 7 дней.
 */
export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt.getTime() < Date.now()) {
    return null;
  }

  if (Date.now() - session.lastSeenAt.getTime() > ROLLING_THRESHOLD_MS) {
    await db.session.update({
      where: { id: session.id },
      data: {
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
  }

  return { id: session.user.id, email: session.user.email };
}

/** Удаляет текущую сессию из БД и очищает cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await db.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => {});
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
