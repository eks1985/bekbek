# auth — вход по коду на email

Скелет авторизации: пользователь вводит email → получает 6-значный код →
после ввода кода создаётся сессия на 7 дней (rolling-продление), браузер
помнит вход без повторного ввода кода.

**Стек:** Next.js 16 (App Router) · Prisma 7 (driver adapter + node-pg) ·
PostgreSQL · Tailwind v4 · shadcn/ui. Крипта — `node:crypto`, без
auth-библиотек. Хостинг — Layero (serverless), боевая БД — PostgreSQL на
Layero, почта — Notisend HTTP API.

## Как это устроено

- **Пароля нет, отдельной регистрации тоже.** Код отправляется на любой email,
  а пользователь создаётся при первом верном коде (`upsert` в
  `/api/auth/verify`). Верный код подтверждает, что почта принадлежит человеку,
  поэтому в базу не попадают опечатки и чужие адреса. `npm run user:add` —
  необязательный способ завести пользователя заранее.
- **Коды:** 6 цифр, TTL 10 минут, в БД только `sha256(email:код)`. Один активный
  код на email, ≥5 неверных попыток — код сгорает.
- **Сессии:** случайный токен в cookie, в БД — его `sha256`. Cookie `httpOnly`,
  `SameSite=Lax`, 7 дней. В проде имя `__Host-session` (требует HTTPS), локально
  `session`. Реальная проверка — в серверном компоненте через `getSession()`;
  `src/proxy.ts` (бывший middleware) лишь смотрит наличие cookie.
- **Rate-limit** и чистка протухшего — в БД, без фоновых задач (их нет на
  serverless). Запрос кода — не больше 3 на email и 10 на IP за 15 минут:
  заодно это не даёт рассылать коды на чужие адреса.

## Локальный запуск

```bash
npm install
cp .env.example .env.local          # при необходимости поправьте DATABASE_URL
npm run db:migrate                  # создаст таблицы в вашем Postgres
npm run dev
```

Откройте <http://localhost:3000> → `/login`, введите любой email, например
`test@example.com` — пользователь создастся при вводе верного кода.
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
2. **База:** PostgreSQL на Layero (база `bek-bek`), подключена к проекту.
   Строку подключения платформа сама кладёт в `LAYERO_DATABASE_URL`, и код
   (`src/lib/db.ts`, `prisma.config.ts`, `scripts/create-user.mjs`) берёт её
   первой, а `DATABASE_URL` — только если её нет (локально). TLS обязателен;
   на Layero `sslmode` уже в строке, сертификат Let's Encrypt node-pg проверяет
   по системным корням — CA-файл не нужен. Размер пула
   задан в коде — `max=3`.
3. **Env vars** в дашборде Layero: `SESSION_COOKIE_SECURE=true`,
   `MAILER=notisend`, `NOTISEND_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME`, `APP_URL`.
   `DATABASE_URL` в проекте не задавайте.
4. **Миграции** накатывайте против прод-БД отдельно — `npm run db:deploy` —
   а не во время сборки Layero (не завязываем билд на доступность БД).
   Порядок — в разделе «Изменение таблиц БД» ниже.
5. **Выкладка кода** — push в `main` на GitLab: вебхук запускает сборку на
   Layero, через 2–3 минуты новая версия на https://bek-bek.layero.app. Если
   сборка упала, живой остаётся предыдущая версия.

Холодный старт SSR Next.js на serverless ~9 c — на кнопке «Получить код» уже
стоит pending-стейт, чтобы пользователь не жал её повторно.

## Таблицы тренировок

- `fit_files` — загруженные FIT-файлы. Сам файл лежит в Selectel S3, в
  таблице — ключ объекта (`storageKey`), имя, размер и `sha256`. Один и тот же
  файл пользователь второй раз не загрузит (уникальная пара `userId` + `sha256`).
- `workouts` — результат парсинга, один на файл. Весь `ParsedWorkout` без
  посекундных точек лежит в колонке `data` (jsonb). Поля для фильтров и
  сортировки (`startTime`, `distanceM`, `avgPaceSecPerKm`, `avgHeartRate`,
  `workoutTag`, …) продублированы обычными колонками с индексами. Их
  заполняет `workoutRow()` из `src/lib/workouts/to-row.ts`. `title` —
  название, которое вводит пользователь; при повторном разборе оно не
  затирается.

Обе таблицы ссылаются на `users`. При удалении пользователя удаляются его
файлы и тренировки, при удалении файла — его тренировка.

Нужен новый фильтр — добавьте колонку в модель `Workout` и в `workoutRow()`,
а в миграции заполните её для старых строк из `data`, например
`UPDATE workouts SET "maxHeartRate" = (data->'summary'->>'maxHeartRate')::int;`.
Если меняется формат `data`, увеличьте `PARSER_VERSION`. По этому номеру
видно, какие тренировки надо переразобрать.

## Изменение таблиц БД (миграции Prisma)

Две команды, и у каждой своя база:

- `npm run db:migrate` (`prisma migrate dev`) — **только локальная база**.
  Сравнивает `schema.prisma` с базой, создаёт файл миграции в
  `prisma/migrations/` и сразу применяет его локально.
- `npm run db:deploy` (`prisma migrate deploy`) — **прод**. Новых миграций
  не создаёт, только применяет ещё не накатанные файлы из `prisma/migrations/`.
  Базу не сбрасывает, ничего не спрашивает.

Layero при сборке миграции не запускает (`build` = `prisma generate && next build`),
их накатывают вручную.

### Порядок

1. Правим `prisma/schema.prisma`.
2. Создаём миграцию и применяем её к локальной базе:
   ```powershell
   npm run db:migrate -- --name add_user_nickname
   ```
   Смотрим сгенерированный `prisma/migrations/<дата>_add_user_nickname/migration.sql` —
   именно этот SQL выполнится на проде.
3. Проверяем локально: `npm run dev`.
4. Коммитим `schema.prisma` **вместе с папкой миграции** — без неё прод о
   изменении не узнает.
5. Накатываем миграцию на прод (см. ниже).
6. `git push` в `main` — Layero соберёт новый код.

### Накатить на прод

Нужны:

- **доступ снаружи** — вкладка «Сеть» базы: «Список адресов» с вашим IP или
  «Открыто всем»;
- **строка подключения с паролем** — панель → база → «Подключить», роль
  «Владелец базы», «Показать пароль» → «Скопировать». Выглядит так:
  `postgresql://mgr_bekbek_owner:ПАРОЛЬ@db.layero.ru:5432/mgr_bekbek?sslmode=require`.
  CLI (`layero db list`) отдаёт ту же строку, но с заглушкой `<пароль>` —
  для подключения она не годится.

`prisma.config.ts` берёт `DATABASE_URL` из `.env.local`, но переменная,
заданная в терминале, важнее (`process.loadEnvFile` её не перезаписывает).
Прод-адрес кладём в переменную только на время команды. Пароль держим во
временном файле, чтобы не светить его в истории PowerShell:

```powershell
# 1. Строка из панели — во временный файл (после «Скопировать»)
Get-Clipboard | Set-Content C:\Users\kefimov\bek-bek-prod-db.txt

cd C:\Documents\apps\bek-bek
$env:DATABASE_URL = (Get-Content C:\Users\kefimov\bek-bek-prod-db.txt -Raw).Trim()

# 2. Что не накатано — ничего не меняет
npx prisma migrate status
# 3. Накатить
npm run db:deploy
# при необходимости — пользователь для входа
npm run user:add -- you@example.com

# 4. Убрать за собой
Remove-Item Env:DATABASE_URL
Remove-Item C:\Users\kefimov\bek-bek-prod-db.txt
```

В выводе Prisma должно стоять `Datasource "db": … "mgr_bekbek" … at "db.layero.ru:5432"` —
значит, команда смотрит в прод, а не в локальную базу.

Проверить результат можно без пароля, через CLI Layero:

```powershell
npx layero@latest db sql bek-bek -c "select migration_name, finished_at from _prisma_migrations"
npx layero@latest db sql bek-bek -c "select table_name from information_schema.tables where table_schema='bekbek'"
```

⚠️ Не оставляйте прод-адрес в переменной: следующий `npm run dev` или
`db:migrate` в том же окне пойдёт в прод-базу, а `migrate dev` при расхождении
может предложить **сбросить базу**. По той же причине не прописывайте
`LAYERO_DATABASE_URL` в `.env.local` — она приоритетнее `DATABASE_URL`.

**TLS.** Без шифрования база Layero не пускает. Если Prisma ругается на
проверку сертификата, скачайте корень Let's Encrypt (ISRG Root X1,
https://letsencrypt.org/certs/isrgrootx1.pem) и допишите путь к нему в строку:
`…?sslmode=verify-full&sslrootcert=C:/путь/к/isrgrootx1.pem`.

### Что сначала — миграция или код

- **Только добавляем** (новая таблица, поле с `?` или со значением по умолчанию) —
  сначала миграция, потом push: старый код новое поле просто не заметит.
- **Удаляем или переименовываем** — в два шага: сначала код, который старое
  поле больше не использует, потом отдельной миграцией удаление. Иначе между
  миграцией и окончанием сборки живой сайт будет обращаться к колонке,
  которой уже нет.

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
(`--workout`, `--with-points`, `--tolerance`, `--warmup`, `--out`) забирает себе npm — скрипт
тогда останавливается с подсказкой. Ставьте разделитель дважды или запускайте
напрямую:

```powershell
npm run fit:parse -- -- samples/24300728659_ACTIVITY.fit --workout auto
npx tsx scripts/parse-fit.ts samples/24300728659_ACTIVITY.fit --workout auto
```

### Интервалы на стадионе (`--workout`)

GPS на коротких отрезках врёт, поэтому темп можно пересчитать по реальной
дистанции. Круг 1 считается разминкой, дальше — рабочий отрезок, отдых, рабочий…
В режиме `auto` разминку можно растянуть на несколько кругов: `--warmup N` —
первые N кругов разминка, схема ищется с круга N+1 (по умолчанию 1; 0 — без
разминки). В ручных режимах `--warmup` не работает.

```bash
# найти схему самому: быстрые круги округляются до «целых» дистанций с допуском 5 %
npm run fit:parse -- file.fit --workout auto
npm run fit:parse -- file.fit --workout auto --tolerance 3
# разминка — первые 3 круга, первый рабочий отрезок — круг 4
npm run fit:parse -- file.fit --workout auto --warmup 3
# задать рабочие отрезки (отдых не указывается): круги 2, 4, 6…
npm run fit:parse -- file.fit --workout "200 400 600 1000 600x3"
# фартлек: дистанций столько же, сколько кругов в файле — задаётся каждый круг
npm run fit:parse -- file.fit --workout "4000 200 200 400 250 600 400 1000 400 600 400 600 400 600 1000"
# то же, но "-" — оставить дистанцию круга из файла (дефис заодно разделитель)
npm run fit:parse -- file.fit --workout "-200-400-600-1000-600-600-600-"
```

`-` работает только в полной разметке (значений ровно столько, сколько кругов).

У кругов с заданной дистанцией `distanceM` и `avgPace` — по реальной дистанции,
исходные значения — в `gpsDistanceM` и `gpsAvgPace`. Тег схемы
(`"200 400 600 1000 600x3"`) — в `summary.workoutTag`, подробности и
предупреждения — в `workout`. Итоги тренировки и км-сплиты остаются по GPS.

## Графики тренировок (Chart.js)

Библиотека для графиков — **Chart.js 4**. Рабочий пример:
`examples/pace-chart.html` — самодостаточный HTML (Chart.js с CDN, без сборки),
построен на реальных данных пробежки 2026-11-08 (21,12 км): темп по километрам
столбцами + пульс линией. Открывается в браузере двойным кликом.

Приёмы из примера, которые переиспользуем в приложении:

- темп — столбцы с **перевёрнутой осью** (`reverse: true`): меньше сек/км —
  выше столбец (как в Strava/Garmin);
- пульс — линия по второй оси справа; средний темп — плоский пунктир поверх;
- подписи оси темпа в формате «3:51» — через `ticks.callback`;
- неполный последний километр не выбрасывается: полупрозрачный столбец,
  подпись «121 м», в тултипе пометка «финишный отрезок»;
- тултип по индексу (`interaction: { mode: 'index' }`) показывает темп и пульс
  километра одновременно.

В приложение встраивать через `react-chartjs-2` (обёртка Chart.js под React,
рекомендуется в доках Chart.js) с теми же настройками; данные брать из
`data` тренировки (`kmSplits`, `laps`) или MCP-инструмента `get_workout`.

## MCP-сервер (`/api/mcp`)

Эндпоинт Streamable HTTP для Claude и других MCP-клиентов: `src/app/api/mcp/route.ts`,
инструменты — `src/lib/mcp/server.ts`. Stateless, ответы JSON, сервер создаётся
на каждый запрос.

Инструменты: `whoami`, `list_workouts` (фильтры по дате, виду спорта, тегу,
дистанции), `list_fit_files`, `get_workout` (итоги, круги, км-сплиты, схема),
`reparse_workout` (своя схема или auto с допуском/разминкой; лимит тот же, что
у кнопки в интерфейсе).

**Авторизация временная, на время тестов:** сервисный ключ `MCP_SERVICE_KEY`
открывает данные любого пользователя; какого — `?user=<email>`, заголовок
`X-MCP-User` или `MCP_DEFAULT_USER_EMAIL`. Ключ — в `Authorization: Bearer …`
или в `?key=…` (коннектор claude.ai умеет задавать только URL). Без
`MCP_SERVICE_KEY` эндпоинт отвечает 404. Перед открытием приложения для
других людей — заменить на OAuth.

Подключение в claude.ai (свой коннектор):
`https://bek-bek.layero.app/api/mcp?key=<MCP_SERVICE_KEY>&user=<email>`.

## AI-помощник в приложении (план, не реализовано)

Чат с агентом внутри bek-bek: пользователь спрашивает о своих тренировках,
агент читает данные и отвечает. Реализация отложена; здесь зафиксирован
выбранный вариант, чтобы не выбирать заново.

**Вариант — Vercel AI SDK** (пакет `ai` + провайдер-адаптер, MIT). Это просто
библиотека, не сервис: без хостинга и биллинга, исполняется в нашем Next.js и
ходит напрямую к провайдеру моделей по ключу из env. Из коробки — стриминг,
tool-calling и агентный цикл (модель сама решает, какой инструмент вызвать),
React-хук `useChat` для UI.

Отвергнутый вариант — **opencode SDK** (`@opencode/sdk`): встраивает целый
runtime кодинг-агента. Мощно, но: из коробки bash и редактирование файлов —
на прод-контейнере рядом с `LAYERO_DATABASE_URL` это дыра; in-memory-сессии
не переживают засыпание контейнера и редеплои; для чата о данных избыточно.
Вернуться к нему стоит, только если понадобятся агентные задачи (планы,
самостоятельный запуск кода для анализа).

### Как реализуем

- Роут `src/app/api/chat/route.ts`: cookie-сессия → `user.id` (как во всём
  приложении), стрим ответа в браузер. История чатов — таблица в БД:
  контейнер Layero засыпает, in-memory не живёт.
- Инструменты — обычные async-функции, зовут Prisma с `user.id` из сессии
  (переиспользовать запросы из `src/lib/mcp/queries.ts`). MCP внутри своего
  приложения не нужен — он для внешних агентов.
- Безопасность — те же правила, что у MCP-эндпоинта: пользователь только из
  сессии, инструменты ограничены своими данными, rate-limit на пользователя.
- Набросок роута:

  ```ts
  const result = streamText({
    model: anthropic("<модель>"),     // или openaiCompatible() для Zen
    messages,                         // история из БД + новое сообщение
    tools: {
      listWorkouts: tool({
        description: "Тренировки пользователя",
        parameters: WorkoutFilter,    // Zod-схема
        execute: (f) => listWorkouts(user.id, f),
      }),
    },
  });
  return result.toTextStreamResponse();
  ```

### Оплата моделей

Библиотека бесплатна, платим только за токены по ключу провайдера (env на
Layero): прямой ключ Anthropic/OpenAI или opencode Zen (pay-as-you-go,
OpenAI-совместимый эндпоинт). **Личной подпиской OpenCode Go пользователей
не кормим** — лимиты общие на всех, ключ один на приложение, риск фэйр-юза;
годится максимум на альфу из 1–3 человек.

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
examples/pace-chart.html    # пример графика Chart.js: темп и пульс по км
```


//npm run fit:parse -- -- samples/24300728659_ACTIVITY.fit --workout auto
//npx tsx scripts/parse-fit.ts samples/24300728659_ACTIVITY.fit --workout auto