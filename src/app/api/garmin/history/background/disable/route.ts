import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { disableGarminHistorySync } from "@/lib/garmin/client";

export const runtime = "nodejs";

/** Кнопка «Остановить» на /settings. */
export async function POST() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  }

  try {
    const status = await disableGarminHistorySync(user.id);
    return NextResponse.json(status);
  } catch (err) {
    console.error("Не удалось остановить фоновую подгрузку истории", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Не удалось связаться с garmin-sync" },
      { status: 502 },
    );
  }
}
