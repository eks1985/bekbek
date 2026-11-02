import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getGarminHealth } from "@/lib/garmin/client";

export const runtime = "nodejs";

/** Только владелец (один аккаунт Garmin на один email в bek-bek) видит состояние сервиса. */
export async function GET() {
  const user = await getSession();
  const ownerEmail = process.env.GARMIN_OWNER_EMAIL;
  if (!user || !ownerEmail || user.email.toLowerCase() !== ownerEmail.toLowerCase()) {
    return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const health = await getGarminHealth();
    return NextResponse.json({ ...health, response_ms: Date.now() - startedAt });
  } catch (err) {
    console.error("Проверка garmin-sync не удалась", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Не удалось связаться с garmin-sync" },
      { status: 502 },
    );
  }
}
