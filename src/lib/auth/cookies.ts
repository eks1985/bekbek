// Настройки cookie сессии в одном месте.
//
// В проде cookie ставится по HTTPS с префиксом __Host- — браузер тогда требует
// Secure + Path=/ и запрещает атрибут Domain, что изолирует cookie от соседних
// проектов на общем домене (напр. *.layero.app).
//
// В dev по http префикс __Host- поставить нельзя (нужен Secure), поэтому имя
// без префикса. Иначе логин «не залипает» — типичная ловушка.

export const SESSION_SECURE = process.env.SESSION_COOKIE_SECURE === "true";

export const SESSION_COOKIE_NAME = SESSION_SECURE ? "__Host-session" : "session";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 дней

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: SESSION_SECURE,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
