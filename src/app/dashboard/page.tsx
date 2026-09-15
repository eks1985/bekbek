import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
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
  // Настоящая проверка сессии (middleware лишь смотрит наличие cookie).
  const user = await getSession();
  if (!user) redirect("/login");

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
