import "server-only";

const DEFAULT_TIMEOUT_MS = 5000;

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
async function garminFetch(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const { baseUrl, token } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
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
