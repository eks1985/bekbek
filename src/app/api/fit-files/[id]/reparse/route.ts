import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { reparseFitFile } from "@/lib/fit-files/reparse";
import { allowReparse } from "@/lib/rate-limit";
import { reparseSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/fit-files/[id]/reparse">,
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const parsed = reparseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Проверьте схему, допуск и число кругов разминки" },
      { status: 400 },
    );
  }

  if (!(await allowReparse(user.id))) {
    return NextResponse.json(
      { error: "Слишком много разборов подряд. Подождите немного." },
      { status: 429 },
    );
  }

  const { id } = await ctx.params;

  try {
    const result = await reparseFitFile(user.id, id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.workout);
  } catch (err) {
    console.error(`Не удалось разобрать заново ${id}:`, err);
    return NextResponse.json({ error: "Не удалось разобрать файл" }, { status: 500 });
  }
}
