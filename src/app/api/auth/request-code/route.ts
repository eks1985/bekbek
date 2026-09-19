import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/request";
import { requestCodeSchema } from "@/lib/validation";
import { allowRequestCode } from "@/lib/rate-limit";
import { issueCode, purgeExpiredCodes } from "@/lib/auth/codes";
import { getMailer } from "@/lib/mail";

export const runtime = "nodejs";

// Код отправляется на любой email: регистрации заранее нет, пользователь
// создаётся в /api/auth/verify при первом верном коде. Верный код и есть
// подтверждение, что почта принадлежит человеку.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const parsed = requestCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный email" }, { status: 400 });
  }

  const { email } = parsed.data;
  const ip = getClientIp(req);

  await purgeExpiredCodes();

  // Лимиты заодно не дают рассылать коды на чужие адреса.
  const allowed = await allowRequestCode(email, ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте позже." },
      { status: 429 },
    );
  }

  const code = await issueCode(email, ip);
  try {
    await getMailer().sendCode(email, code);
  } catch (err) {
    console.error("[request-code] ошибка отправки письма:", err);
    return NextResponse.json(
      { error: "Не удалось отправить письмо. Попробуйте позже." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, message: "Код отправлен на почту." });
}
