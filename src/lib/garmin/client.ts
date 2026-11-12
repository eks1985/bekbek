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

export async function getGarminHealth(userId: string): Promise<GarminHealth> {
  const res = await garminFetch(`/users/${userId}/health`);
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
export async function triggerGarminSync(userId: string): Promise<GarminSyncResult> {
  const res = await garminFetch(`/users/${userId}/sync`, { method: "POST" }, 20000);
  if (!res.ok) {
    throw new Error(`garmin-sync /sync ответил ${res.status}`);
  }
  return res.json();
}

export type GarminHistoryResult = {
  downloaded: string[];
  failed: string[];
  has_more?: boolean;
  busy?: boolean;
};

/** Подгрузка следующей порции старых активностей — клик «+10 тренировок». */
export async function triggerGarminHistorySync(
  userId: string,
  count: number,
): Promise<GarminHistoryResult> {
  const res = await garminFetch(
    `/users/${userId}/sync/history?count=${count}`,
    { method: "POST" },
    20000,
  );
  if (!res.ok) {
    throw new Error(`garmin-sync /sync/history ответил ${res.status}`);
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

export async function listGarminActivities(userId: string): Promise<GarminActivity[]> {
  const res = await garminFetch(`/users/${userId}/activities`);
  if (!res.ok) {
    throw new Error(`garmin-sync /activities ответил ${res.status}`);
  }
  return res.json();
}

export async function downloadGarminFit(
  userId: string,
  activityId: string | number,
): Promise<Uint8Array> {
  const res = await garminFetch(`/users/${userId}/activities/${activityId}/fit`, {}, 15000);
  if (!res.ok) {
    throw new Error(`garmin-sync /activities/${activityId}/fit ответил ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export type GarminWorkoutResult = {
  ok: boolean;
  workoutId: string | number | null;
  workoutName: string | null;
};

/**
 * Создаёт структурированную тренировку (бег) в Garmin Connect — payload в
 * форме createWorkoutSchema (src/lib/validation.ts, та же модель, что
 * конструктор на /structured-workouts). garmin-sync строит её через
 * app/workout_builder.py и грузит в Garmin под токенами этого пользователя.
 */
export async function createGarminWorkout(
  userId: string,
  payload: { workoutName: string; blocks: unknown[] },
): Promise<GarminWorkoutResult> {
  const res = await garminFetch(
    `/users/${userId}/workouts`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    20000,
  );
  if (!res.ok) {
    const data: { detail?: string } = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? `garmin-sync /workouts ответил ${res.status}`);
  }
  return res.json();
}

export type GarminHistoryStatus = {
  active: boolean;
  offset: number;
  rate_per_hour: number;
};

/**
 * Фоновая подгрузка всей истории — garmin-sync сам тянет по одной активности
 * в ~rate_per_hour час, пока не кончится история (см. app/main.py,
 * _history_loop). Это чтения/записи meta, не поход в Garmin — обычный таймаут.
 */
export async function enableGarminHistorySync(userId: string): Promise<GarminHistoryStatus> {
  const res = await garminFetch(`/users/${userId}/history/enable`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`garmin-sync /history/enable ответил ${res.status}`);
  }
  return res.json();
}

export async function disableGarminHistorySync(userId: string): Promise<GarminHistoryStatus> {
  const res = await garminFetch(`/users/${userId}/history/disable`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`garmin-sync /history/disable ответил ${res.status}`);
  }
  return res.json();
}

export async function getGarminHistoryStatus(userId: string): Promise<GarminHistoryStatus> {
  const res = await garminFetch(`/users/${userId}/history/status`);
  if (!res.ok) {
    throw new Error(`garmin-sync /history/status ответил ${res.status}`);
  }
  return res.json();
}

/**
 * Ссылка на /auth сервиса с короткоживущей (10 мин) HMAC-подписью вместо
 * ручного ввода GARMIN_SYNC_TOKEN — тот же секрет, что и для серверных
 * вызовов, отдельного не заводим. Подпись по "<userId>:<exp>" — ссылку
 * одного пользователя нельзя переиспользовать для входа в чужой аккаунт.
 * Сервис проверяет независимо (require_token_or_link в garmin-sync/app/main.py).
 */
export function buildGarminAuthLink(userId: string): string {
  const { baseUrl, token } = config();
  const exp = Math.floor(Date.now() / 1000) + AUTH_LINK_TTL_SEC;
  const sig = createHmac("sha256", token).update(`${userId}:${exp}`).digest("hex");
  return `${baseUrl}/users/${userId}/auth?link=${exp}.${sig}`;
}
