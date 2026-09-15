import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifySchema } from "@/lib/validation";
import { verifyCode } from "@/lib/auth/codes";
import { createSession } from "@/lib/auth/session";

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

  const result = await verifyCode(email, code);
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "Код истёк. Запросите новый."
        : "Неверный код.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Код валиден — пользователь обязан существовать (мог быть удалён между
  // запросом кода и проверкой; тогда трактуем как неверный код).
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "Неверный код." }, { status: 400 });
  }

  await createSession(user.id);

  return NextResponse.json({ ok: true });
}
