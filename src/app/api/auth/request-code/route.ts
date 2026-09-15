import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/request";
import { requestCodeSchema } from "@/lib/validation";
import { allowRequestCode } from "@/lib/rate-limit";
import { issueCode, purgeExpiredCodes } from "@/lib/auth/codes";
import { getMailer } from "@/lib/mail";

export const runtime = "nodejs";

// Единый ответ независимо от того, зарегистрирован email или нет — чтобы форму
// нельзя было использовать как проверялку «кто у вас есть».
const generic = () =>
  NextResponse.json({
    ok: true,
    message: "Если email зарегистрирован, код отправлен.",
  });

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

  const allowed = await allowRequestCode(email, ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте позже." },
      { status: 429 },
    );
  }

  const user = await db.user.findUnique({ where: { email } });

  if (user) {
    const code = await issueCode(email, ip);
    try {
      await getMailer().sendCode(email, code);
    } catch (err) {
      // Не раскрываем наружу, что для этого email была попытка отправки.
      console.error("[request-code] ошибка отправки письма:", err);
    }
  }

  return generic();
}
