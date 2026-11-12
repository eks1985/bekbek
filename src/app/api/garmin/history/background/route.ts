import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { enableGarminHistorySync, getGarminHistoryStatus } from "@/lib/garmin/client";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  }

  try {
    const status = await getGarminHistoryStatus(user.id);
    return NextResponse.json(status);
  } catch (err) {
    console.error("Не удалось получить статус фоновой подгрузки истории", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Не удалось связаться с garmin-sync" },
      { status: 502 },
    );
  }
}

/** Кнопка «Начать загрузку истории» на /settings. */
export async function POST() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  }

  try {
    const status = await enableGarminHistorySync(user.id);
    return NextResponse.json(status);
  } catch (err) {
    console.error("Не удалось включить фоновую подгрузку истории", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Не удалось связаться с garmin-sync" },
      { status: 502 },
    );
  }
}
