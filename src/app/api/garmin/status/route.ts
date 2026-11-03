import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getGarminHealth } from "@/lib/garmin/client";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const health = await getGarminHealth(user.id);
    return NextResponse.json({ ...health, response_ms: Date.now() - startedAt });
  } catch (err) {
    console.error("Проверка garmin-sync не удалась", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Не удалось связаться с garmin-sync" },
      { status: 502 },
    );
  }
}
