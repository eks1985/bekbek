import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getFitFile } from "@/lib/fit-files/queries";
import { readStoredWorkout } from "@/lib/workouts/stored";
import { DEFAULT_TOLERANCE_PCT, DEFAULT_WARMUP_LAPS } from "@/lib/fit";
import { WorkoutSummary } from "@/components/fit-files/workout-summary";
import { ReparseForm } from "@/components/fit-files/reparse-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const runtime = "nodejs";

export default async function FitFilePage(props: PageProps<"/fit-files/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;

  // В запросе есть userId — чужой файл не откроется даже по прямой ссылке.
  const file = await getFitFile(user.id, id);
  if (!file) notFound();

  const parsed = file.workout ? readStoredWorkout(file.workout.data) : null;
  const scheme = parsed?.workout ?? null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/dashboard" aria-label="Назад к списку" />}
        >
          <ChevronLeft />
        </Button>
        <h1 className="truncate text-lg font-semibold">{file.originalName}</h1>
      </div>

      {parsed === null ? (
        <Card>
          <CardHeader>
            <CardTitle>Файл не разобран</CardTitle>
            <CardDescription>
              Сам файл лежит в хранилище — нажмите «Разобрать заново», чтобы
              разобрать его сейчас.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Сводка</CardTitle>
              <CardDescription>
                {scheme?.source === "manual"
                  ? "Разбор по своей схеме"
                  : `Разбор режимом auto, допуск ${scheme?.tolerancePct ?? DEFAULT_TOLERANCE_PCT} %`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WorkoutSummary workout={parsed} fitFileId={file.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Тег тренировки</CardTitle>
              <CardDescription>
                {scheme === null
                  ? "Схема интервалов не запрашивалась"
                  : `Источник: ${scheme.source}` +
                    (scheme.warmupLaps === null ? "" : `, разминка — кругов: ${scheme.warmupLaps}`)}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="font-mono text-lg font-semibold">
                {scheme?.tag ?? <span className="font-sans text-base font-normal text-muted-foreground">
                  Схема не найдена
                </span>}
              </p>
              {scheme?.adjustedAvgPace && (
                <p className="text-sm text-muted-foreground">
                  Отрезки: {(scheme.adjustedDistanceM ?? 0) / 1000} км, темп{" "}
                  {scheme.adjustedAvgPace}
                </p>
              )}
              {scheme?.warnings.map((warning) => (
                <p key={warning} className="text-sm text-amber-600 dark:text-amber-500">
                  ⚠ {warning}
                </p>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {/* Форма нужна и для неразобранного файла — ей его и разбираем. */}
      <Card>
        <CardHeader>
          <CardTitle>Разобрать заново</CardTitle>
          <CardDescription>
            Если тег определился неверно — поменяйте параметры или задайте схему вручную.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReparseForm
            fitFileId={file.id}
            defaults={{
              tolerancePct: scheme?.tolerancePct ?? DEFAULT_TOLERANCE_PCT,
              warmupLaps: scheme?.warmupLaps ?? DEFAULT_WARMUP_LAPS,
              pattern: scheme?.tag ?? "",
              lapCount: parsed?.summary.lapCount ?? null,
              // Файл не разобран или разобран auto — открываем вкладку auto.
              source: scheme?.source === "manual" ? "manual" : "auto",
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
