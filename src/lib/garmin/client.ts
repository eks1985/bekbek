import "server-only";
import { createHmac } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 5000;
const AUTH_LINK_TTL_SEC = 600; // 10 минут — время на форму + код MFA

export type GarminHealth = {
  ok: boolean;
  last_sync_at: string | null;
  garmin_logged_in: boolean;
};

function config(): { baseUrl: string; token: string } {
  const baseUrl = process.env.GARMIN_SYNC_URL;
  const token = process.env.GARMIN_SYNC_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("GARMIN_SYNC_URL / GARMIN_SYNC_TOKEN не заданы");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

/** Запрос к сервису garmin-sync на VPS: bearer-токен и таймаут на связь Layero → VPS. */
async function garminFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const { baseUrl, token } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getGarminHealth(): Promise<GarminHealth> {
  const res = await garminFetch("/health");
  if (!res.ok) {
    throw new Error(`garmin-sync /health ответил ${res.status}`);
  }
  return res.json();
}

export type GarminSyncResult = {
  checked_at: string;
  downloaded: string[];
  failed: string[];
  throttled: boolean;
};

/** POST /sync сервиса может реально сходить в Garmin — таймаут больше, чем у /health. */
export async function triggerGarminSync(): Promise<GarminSyncResult> {
  const res = await garminFetch("/sync", { method: "POST" }, 20000);
  if (!res.ok) {
    throw new Error(`garmin-sync /sync ответил ${res.status}`);
  }
  return res.json();
}

export type GarminActivity = {
  activity_id: string | number;
  start_time: string | null;
  activity_type: string | null;
  name: string | null;
  sha256: string | null;
  size_bytes: number | null;
  status: string;
};

export async function listGarminActivities(): Promise<GarminActivity[]> {
  const res = await garminFetch("/activities");
  if (!res.ok) {
    throw new Error(`garmin-sync /activities ответил ${res.status}`);
  }
  return res.json();
}

export async function downloadGarminFit(activityId: string | number): Promise<Uint8Array> {
  const res = await garminFetch(`/activities/${activityId}/fit`, {}, 15000);
  if (!res.ok) {
    throw new Error(`garmin-sync /activities/${activityId}/fit ответил ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Ссылка на /auth сервиса с короткоживущей (10 мин) HMAC-подписью вместо
 * ручного ввода GARMIN_SYNC_TOKEN — тот же секрет, что и для серверных
 * вызовов, отдельного не заводим. Сервис проверяет подпись независимо
 * (require_token_or_link в garmin-sync/app/main.py).
 */
export function buildGarminAuthLink(): string {
  const { baseUrl, token } = config();
  const exp = Math.floor(Date.now() / 1000) + AUTH_LINK_TTL_SEC;
  const sig = createHmac("sha256", token).update(String(exp)).digest("hex");
  return `${baseUrl}/auth?link=${exp}.${sig}`;
}
