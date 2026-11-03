import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { importGarminHistory } from "@/lib/garmin/import";

export const runtime = "nodejs";

/** Клик «+10 тренировок»: подгружает следующую порцию старой истории. */
export async function POST() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  }

  try {
    const summary = await importGarminHistory(user.id, 10);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("Подгрузка истории Garmin не удалась", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Не удалось связаться с garmin-sync" },
      { status: 502 },
    );
  }
}
