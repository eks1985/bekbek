import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { WorkoutBuilder } from "@/components/structured-workouts/workout-builder";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";

export default async function StructuredWorkoutsPage() {
  await requireUser();

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
        <h1 className="truncate text-lg font-semibold">Структурированная тренировка</h1>
      </div>

      <WorkoutBuilder />
    </main>
  );
}
