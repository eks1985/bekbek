// Реальный IP клиента за обратным прокси (Layero / Cloudflare) — первый хоп
// X-Forwarded-For. Без этого rate-limit по IP считал бы все запросы одним.
export function getClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
