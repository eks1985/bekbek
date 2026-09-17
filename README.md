# auth — вход по коду на email

Скелет авторизации: пользователь вводит email → получает 6-значный код →
после ввода кода создаётся сессия на 7 дней (rolling-продление), браузер
помнит вход без повторного ввода кода.

**Стек:** Next.js 16 (App Router) · Prisma 7 (driver adapter + node-pg) ·
PostgreSQL · Tailwind v4 · shadcn/ui. Крипта — `node:crypto`, без
auth-библиотек. Хостинг — Layero (serverless), боевая БД — Yandex Managed
PostgreSQL, почта — Notisend HTTP API.

## Как это устроено

- **Пароля нет.** Вход только по коду, и только для заранее заведённых
  пользователей (`npm run user:add`). Незнакомый email получает такой же ответ,
  как знакомый, — форму нельзя использовать как проверялку «кто зарегистрирован».
- **Коды:** 6 цифр, TTL 10 минут, в БД только `sha256(email:код)`. Один активный
  код на email, ≥5 неверных попыток — код сгорает.
- **Сессии:** случайный токен в cookie, в БД — его `sha256`. Cookie `httpOnly`,
  `SameSite=Lax`, 7 дней. В проде имя `__Host-session` (требует HTTPS), локально
  `session`. Реальная проверка — в серверном компоненте через `getSession()`;
  `src/proxy.ts` (бывший middleware) лишь смотрит наличие cookie.
- **Rate-limit** и чистка протухшего — в БД, без фоновых задач (их нет на
  serverless).

## Локальный запуск

```bash
npm install
cp .env.example .env.local          # при необходимости поправьте DATABASE_URL
npm run db:migrate                  # создаст таблицы в вашем Postgres
npm run user:add -- test@example.com
npm run dev
```

Откройте <http://localhost:3000> → `/login`, введите `test@example.com`.
При `MAILER=console` (по умолчанию) **код печатается в консоль сервера** —
возьмите его оттуда и введите на втором шаге. После входа — `/dashboard`.

## Реальная отправка писем (Notisend)

В `.env.local` (или в переменных Layero):

```
MAILER=notisend
NOTISEND_API_KEY=<ключ из панели Notisend>
MAIL_FROM=noreply@ваш-домен.ru
MAIL_FROM_NAME=Вход
```

Домен-отправитель нужно подтвердить в Notisend (SPF/DKIM/DMARC в DNS). Приём
почты и DNS могут оставаться на Яндексе — меняется только отправка. Если на
домене уже есть SPF Яндекса, **не заводите вторую запись `v=spf1`** — слейте в
одну: `v=spf1 include:_spf.yandex.net include:<хост Notisend> ~all`.

## Деплой на Layero

1. Тариф **Pro** (512 MB RAM — SSR Next.js на 256 ловит OOM; домен и индексация
   тоже только Pro). Runtime type определится как `ssr_next`.
2. **База:** Yandex Managed PostgreSQL. Скачайте CA-сертификат (см.
   [`certs/README.md`](certs/README.md)).
3. **Env vars** в дашборде Layero: `DATABASE_URL` (строка YC),
   `DATABASE_CA_PATH=./certs/yandex-root.crt` (node-pg проверяет сертификат по
   этому файлу; размер пула задан в коде — `max=3`), `SESSION_COOKIE_SECURE=true`,
   `MAILER=notisend`, `NOTISEND_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME`, `APP_URL`.
4. **Миграции** накатывайте против прод-БД отдельно — `npm run db:deploy` —
   а не во время сборки Layero (не завязываем билд на доступность БД).

Холодный старт SSR Next.js на serverless ~9 c — на кнопке «Получить код» уже
стоит pending-стейт, чтобы пользователь не жал её повторно.

## Парсер FIT-файлов тренировок

```bash
npm run fit:parse -- samples/24300728659_ACTIVITY.fit     # → output/24300728659_ACTIVITY.json
npm run fit:parse -- samples/                             # все .fit в папке
npm run fit:parse -- samples/ --with-points --out results # с посекундными точками, в другую папку
```

В JSON: `source` (устройство), `summary` (итоги тренировки), `workout` (схема
интервалов), `laps` (все круги), `kmSplits` (сплиты по 1 км: из автокругов часов
или посчитанные по точкам) и — с `--with-points` — `points` (точки записи).
Бинарный формат читает официальный `@garmin/fitsdk`, остальное — `src/lib/fit/`:
файлы с номерами `1-…7-` — шаги по порядку, `parse-workout.ts` вызывает их по очереди.

**PowerShell:** при вызове `npm` PowerShell убирает разделитель `--`, и флаги
(`--workout`, `--with-points`, `--tolerance`, `--out`) забирает себе npm — скрипт
тогда останавливается с подсказкой. Ставьте разделитель дважды или запускайте
напрямую:

```powershell
npm run fit:parse -- -- samples/24300728659_ACTIVITY.fit --workout auto
npx tsx scripts/parse-fit.ts samples/24300728659_ACTIVITY.fit --workout auto
```

### Интервалы на стадионе (`--workout`)

GPS на коротких отрезках врёт, поэтому темп можно пересчитать по реальной
дистанции. Круг 1 считается разминкой, дальше — рабочий отрезок, отдых, рабочий…

```bash
# найти схему самому: быстрые круги округляются до «целых» дистанций с допуском 5 %
npm run fit:parse -- file.fit --workout auto
npm run fit:parse -- file.fit --workout auto --tolerance 3
# задать рабочие отрезки (отдых не указывается): круги 2, 4, 6…
npm run fit:parse -- file.fit --workout "200 400 600 1000 600x3"
# фартлек: дистанций столько же, сколько кругов в файле — задаётся каждый круг
npm run fit:parse -- file.fit --workout "4000 200 200 400 250 600 400 1000 400 600 400 600 400 600 1000"
```

У кругов с заданной дистанцией `distanceM` и `avgPace` — по реальной дистанции,
исходные значения — в `gpsDistanceM` и `gpsAvgPace`. Тег схемы
(`"200 400 600 1000 600x3"`) — в `summary.workoutTag`, подробности и
предупреждения — в `workout`. Итоги тренировки и км-сплиты остаются по GPS.

## Структура

```
prisma/schema.prisma        # User, LoginCode, Session, RateHit
scripts/create-user.mjs     # npm run user:add -- email
src/proxy.ts                # проверка cookie на границе (Next 16: бывш. middleware)
src/lib/db.ts               # PrismaClient singleton
src/lib/auth/               # codes.ts, session.ts, cookies.ts
src/lib/mail/               # index (фабрика), console, notisend, types
src/lib/rate-limit.ts       # лимиты в БД
src/app/login/page.tsx      # форма: email → код
src/app/dashboard/page.tsx  # защищённая страница
src/app/api/auth/*          # request-code, verify, logout
```


//npm run fit:parse -- -- samples/24300728659_ACTIVITY.fit --workout auto
//npx tsx scripts/parse-fit.ts samples/24300728659_ACTIVITY.fit --workout auto