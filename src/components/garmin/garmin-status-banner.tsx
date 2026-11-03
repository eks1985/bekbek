import { buildGarminAuthLink, getGarminHealth } from "@/lib/garmin/client";

/**
 * Рендерится только владельцу (см. dashboard/page.tsx). Если сервис
 * недоступен — молчим, не роняем dashboard: это необязательная подсказка,
 * не критичная функциональность.
 */
export async function GarminStatusBanner() {
  let loggedIn: boolean;
  try {
    loggedIn = (await getGarminHealth()).garmin_logged_in;
  } catch {
    return null;
  }
  if (loggedIn) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">Garmin отключён — токен устарел.</p>
      <a
        href={buildGarminAuthLink()}
        className="mt-1 inline-block underline underline-offset-2 hover:no-underline"
      >
        Обновить вход в Garmin →
      </a>
    </div>
  );
}
