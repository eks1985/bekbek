import { requireUser } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";
import { FitUpload } from "@/components/fit-files/fit-upload";
import { FitFileList } from "@/components/fit-files/fit-file-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const runtime = "nodejs";

export default async function DashboardPage() {
  // Настоящая проверка сессии (proxy лишь смотрит наличие cookie).
  // requireUser сам уведёт на /login, если не вошёл, и вернёт пользователя.
  const user = await requireUser();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Вы вошли</CardTitle>
          <CardDescription>Защищённая страница.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Аккаунт: <span className="font-medium text-foreground">{user.email}</span>
          </p>
          <LogoutButton />
        </CardContent>
      </Card>

      <FitUpload />
      <FitFileList userId={user.id} />
    </main>
  );
}
