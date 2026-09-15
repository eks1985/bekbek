import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next.js 16: бывший middleware переименован в proxy (функция тоже proxy),
// работает на Node.js runtime. Здесь только дешёвая проверка на границе: есть
// ли вообще cookie сессии. Настоящую валидацию (запрос в БД) делает серверный
// компонент через getSession(), чтобы не ходить в базу на каждый запрос.
// Проверяем оба имени cookie (prod __Host-, dev обычное).
const COOKIE_NAMES = ["__Host-session", "session"];

export function proxy(req: NextRequest) {
  const hasCookie = COOKIE_NAMES.some((name) => req.cookies.has(name));

  if (!hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
