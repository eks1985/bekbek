import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { emailSchema } from "@/lib/validation";
import type { SessionUser } from "@/lib/auth/session";

// Временная авторизация MCP на время тестов: один сервисный ключ из env
// (MCP_SERVICE_KEY) открывает доступ к данным любого пользователя, а какого
// именно — говорит параметр user. Потом заменить на OAuth.
//
// Ключ принимается двумя способами:
//   Authorization: Bearer <ключ>      — для клиентов, которые умеют заголовки;
//   /api/mcp?key=<ключ>               — для коннектора claude.ai, где задаётся
//                                       только URL. Минус: ключ попадает в логи.
// Пользователь: ?user=<email>, заголовок X-MCP-User или MCP_DEFAULT_USER_EMAIL.

export type McpAuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401 | 403 | 404; error: string };

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Сравнение без утечки по времени; хеши выравнивают длину. */
function sameKey(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

export async function authenticateMcp(req: Request): Promise<McpAuthResult> {
  const expected = process.env.MCP_SERVICE_KEY?.trim();
  if (!expected) {
    // Ключ не задан — эндпоинт выключен, делаем вид, что его нет.
    return { ok: false, status: 404, error: "Not found" };
  }

  const url = new URL(req.url);
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const given = bearer || url.searchParams.get("key")?.trim() || "";

  if (!given || !sameKey(given, expected)) {
    return { ok: false, status: 401, error: "Неверный ключ MCP" };
  }

  const rawEmail =
    url.searchParams.get("user") ??
    req.headers.get("x-mcp-user") ??
    process.env.MCP_DEFAULT_USER_EMAIL ??
    "";
  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) {
    return {
      ok: false,
      status: 403,
      error: "Укажите пользователя: ?user=<email> или MCP_DEFAULT_USER_EMAIL",
    };
  }

  const user = await db.user.findUnique({
    where: { email: email.data },
    select: { id: true, email: true },
  });
  if (!user) {
    return { ok: false, status: 403, error: "Пользователь не найден" };
  }

  return { ok: true, user };
}
