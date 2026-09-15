import { requireUser } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";
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
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
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
    </main>
  );
}
