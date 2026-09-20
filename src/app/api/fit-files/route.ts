import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { uploadFitFile } from "@/lib/fit-files/upload";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Нужно войти" }, { status: 401 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
  }

  try {
    const result = await uploadFitFile(user.id, file);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.file, { status: 201 });
  } catch (err) {
    console.error("FIT upload failed", err);
    return NextResponse.json(
      { error: "Не удалось загрузить файл" },
      { status: 500 },
    );
  }
}
