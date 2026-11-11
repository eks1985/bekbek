import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createGarminWorkout } from "@/lib/garmin/client";
import { createWorkoutSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Кнопка «Отправить в Garmin Connect» на /structured-workouts. */
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createWorkoutSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректная схема тренировки" }, { status: 400 });
  }

  try {
    const result = await createGarminWorkout(user.id, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Создание тренировки в Garmin не удалось", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Не удалось связаться с garmin-sync" },
      { status: 502 },
    );
  }
}
