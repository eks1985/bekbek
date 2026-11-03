import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { syncFromGarmin } from "@/lib/garmin/import";

export const runtime = "nodejs";

export async function POST() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  }

  try {
    const summary = await syncFromGarmin(user.id);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("Импорт из Garmin не удался", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Не удалось связаться с garmin-sync" },
      { status: 502 },
    );
  }
}
