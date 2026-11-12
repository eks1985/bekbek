import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getGarminHistoryStatus } from "@/lib/garmin/client";
import { HistorySyncControl } from "@/components/garmin/history-sync-control";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const runtime = "nodejs";

export default async function SettingsPage() {
  const user = await requireUser();

  const status = await getGarminHistoryStatus(user.id).catch(() => null);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/dashboard" aria-label="Назад" />}
        >
          <ChevronLeft />
        </Button>
        <h1 className="truncate text-lg font-semibold">Настройки</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Загрузка истории Garmin</CardTitle>
          <CardDescription>
            Постепенно скачивает всю историю тренировок на фоне — без кликов, но
            медленно, чтобы Garmin не заблокировал аккаунт за частые запросы.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HistorySyncControl initialStatus={status} />
        </CardContent>
      </Card>
    </main>
  );
}
