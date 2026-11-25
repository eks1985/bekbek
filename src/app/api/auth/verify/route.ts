import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/request";
import { codeSchema, verifySchema } from "@/lib/validation";
import { allowVerifyCode } from "@/lib/rate-limit";
import { verifyCode } from "@/lib/auth/codes";
import { createSession } from "@/lib/auth/session";
import { adminCodeEnabled, isAdminCode } from "@/lib/auth/admin-code";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Проверьте email и код" },
      { status: 400 },
    );
  }

  const { email, code } = parsed.data;

  // Включён секретный код (ADMIN_CODE): пока не работает почта, кто знает код,
  // входит под любым email. Код из письма здесь не принимается — письмо на
  // /login не запрашивается. Счётчика попыток у секрета нет, поэтому вход
  // ограничен по IP — не даём перебирать.
  if (adminCodeEnabled()) {
    const allowed = await allowVerifyCode(getClientIp(req));
    if (!allowed) {
      return NextResponse.json(
        { error: "Слишком много попыток. Попробуйте позже." },
        { status: 429 },
      );
    }

    if (!isAdminCode(code)) {
      return NextResponse.json({ error: "Неверный код." }, { status: 400 });
    }

    await signIn(email);
    return NextResponse.json({ ok: true });
  }

  // Дальше — код из письма, ровно 6 цифр: другой формат не должен списывать
  // попытки активного кода email.
  if (!codeSchema.safeParse(code).success) {
    return NextResponse.json(
      { error: "Проверьте email и код" },
      { status: 400 },
    );
  }

  const result = await verifyCode(email, code);
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "Код истёк. Запросите новый."
        : "Неверный код.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Код верный — значит, почта принадлежит человеку. Новый пользователь
  // создаётся здесь, при первом входе; существующий просто находится.
  await signIn(email);

  return NextResponse.json({ ok: true });
}

/**
 * Заводит пользователя (новый создаётся при первом входе, существующий просто
 * находится) и сессию. Для кода из письма верный код подтверждает почту, для
 * секретного — лишь то, что человек в курсе кода: email он выбрал сам.
 */
async function signIn(email: string): Promise<void> {
  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  await createSession(user.id);
}
