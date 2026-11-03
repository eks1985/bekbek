# Импорт тренировок из Garmin Connect через Python-сервис на VPS

## Контекст

Сейчас FIT-файлы в bek-bek попадают только ручной загрузкой (`POST /api/fit-files` → `uploadFitFile()` в `src/lib/fit-files/upload.ts`: проверка, sha256-дедуп, файл в Selectel S3, разбор `parseWorkout(..., {workout:"auto"})`, строки `fit_files` + `workouts`).
Хочется, чтобы тренировка, появившаяся в Garmin Connect, через пару минут без участия пользователя оказывалась в bek-bek. bek-bek живёт на Layero (serverless, РФ), Garmin Connect из РФ ходить неудобно, поэтому рядом ставим маленький Python-сервис на немецком VPS (Dokploy) на библиотеке `garminconnect`.

Решения, принятые с пользователем: код сервиса — папка `garmin-sync/` в этом репо; импорт только новых тренировок (с даты из настройки); один аккаунт Garmin — владельца, привязан к одному email в bek-bek.

**Статус: шаги 1–4 выполнены (2026-11-02).** Сервис живёт на
https://garmin.terravitafze.com (Dokploy, проект `garmin`). Дальше — шаг 5
(проверка связи Layero → VPS). Нюанс Dokploy: docker-контекст у него — корень
репо, поэтому пути в `garmin-sync/Dockerfile` написаны от корня
(`COPY garmin-sync/app/ app/`).

## Архитектура (ключевые ответы)

**Кто кого вызывает — «pull» со стороны bek-bek.** Немецкий VPS не умеет читать российский S3, поэтому сервис в S3 не пишет вообще. Файл идёт так:
`Garmin → (VPS) garmin-sync хранит .fit у себя на диске → bek-bek по HTTPS забирает байты → bek-bek сам кладёт в Selectel S3 (как сейчас) и парсит.`
Направление Layero(РФ) → VPS(DE) — новое и не проверенное, поэтому проверяем его отдельным шагом до основной логики. Запасной вариант, если не пройдёт: сервис сам POST-ит файл в bek-bek (`DE → bek-bek.layero.app`), тоже проверяется заранее.

**Нужна ли сервису своя БД — да, но SQLite-файл** на volume Dokploy (`/data/garmin.db`), без отдельного Postgres. Плюс папка `/data/fit/<activityId>.fit` и токены Garmin (`/data/tokens`). Таблица `activities`: `activity_id` (PK, id Garmin), `start_time`, `activity_type`, `name`, `fit_path`, `sha256`, `size_bytes`, `status` (`downloaded`/`failed`), `error`, `attempts`, `discovered_at`, `downloaded_at`. Таблица/ключ `meta`: `last_sync_at`.

**Дедупликация — на двух уровнях, обе идемпотентны:**
1. В сервисе: `activity_id` — PK. Синхронизация берёт из Garmin список последних ~20 активностей и качает только те id, которых нет (или `failed` с попытками < N). Повторный запуск = 0 скачиваний.
2. В bek-bek источник истины — его собственная БД. Новая колонка `fit_files.garminActivityId` + уникальность `(userId, garminActivityId)`. bek-bek получает от сервиса список id, вычитает уже известные — и забирает только недостающие. Никаких «ack»/курсоров у сервиса: если импорт упал на середине, следующий заход просто доберёт остаток. Существующий `@@unique([userId, sha256])` ловит случай, когда тот же файл раньше загрузили руками — тогда не дублируем, а проставляем `garminActivityId` существующей строке.

**Когда дёргать Garmin:** по требованию — при открытии dashboard bek-bek вызывает свой `/api/garmin/sync`, тот — `POST /sync` сервиса. В сервисе троттлинг (не чаще раза в 60 с; иначе отдаём состояние из SQLite) и lock, чтобы два открытия не пошли в Garmin параллельно. Фоновый опрос по таймеру — опционально в конце (ускорит, но не обязателен).

**Безопасность:** между bek-bek и сервисом — общий секрет `Authorization: Bearer <GARMIN_SYNC_TOKEN>` поверх HTTPS (Traefik + Let's Encrypt в Dokploy). Логин/пароль Garmin существуют только на VPS, и только на время первого входа; дальше живут токены (~год).

## API сервиса (FastAPI)

- `GET /health` — без авторизации, `{ok, last_sync_at, garmin_logged_in}`.
- `POST /sync` — опрос Garmin (с троттлингом) + скачивание новых; ответ `{checked_at, new: [...], throttled: bool}`.
- `GET /activities?since=<ISO>` — список из SQLite: `[{activity_id, start_time, activity_type, name, sha256, size_bytes, status}]`.
- `GET /activities/{id}/fit` — байты `.fit` (`application/octet-stream`).

Скачивание: `api.download_activity(id, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)` возвращает zip → достаём единственный `.fit`, проверяем заголовок `.FIT`, считаем sha256. Список: `api.get_activities(0, 20)`, фильтр по `GARMIN_IMPORT_FROM`.

## Шаги (каждый заканчивается проверкой, следующий — только после неё)

### Шаг 1. Скрипт-прототип локально (без сервера)
`garmin-sync/` : `pyproject.toml`/`requirements.txt` (`garminconnect`, `fastapi`, `uvicorn`), `app/garmin_client.py`, `scripts/login.py`, `scripts/try_download.py`.
- `login.py` — интерактивный вход (с MFA, если включён), токены в `GARMIN_TOKEN_DIR`. Сначала сверить актуальный API версии `garminconnect` (логин/токены менялись между версиями).
- `try_download.py` — печатает последние 10 активностей, скачивает ORIGINAL последней, распаковывает `.fit`.
- **Проверка:** `npm run fit:parse -- <скачанный>.fit --workout auto` в bek-bek разбирает файл, итоги совпадают с тем, что видно в Garmin Connect.

#### Шаг 1 — итог первой попытки и корректировка (2026-11-01)
Код шага 1 закоммичен (ветка `claude/wonderful-goodall-3j8vju`). Запуск `python -m scripts.login` на Windows-машине в РФ:
- `sso.garmin.com` ответил (тикет выдан, раз дело дошло до обмена);
- `diauth.garmin.com` — таймаут 30 с (обмен тикета на DI-токен);
- `mobile.integration.garmin.com` — DNS не резолвится.
В `garmin_tokens.json` библиотека пишет только DI-токены, поэтому запасной путь JWT_WEB (cookie) токенов на диск не даёт — локальный вход из РФ бесполезен. Это подтверждает исходное решение: в Garmin ходит только VPS в Германии. **Шаг 1 переносим на VPS** (локальный ПК для Garmin не используем).

Доработки кода (маленький коммит):
- `garmin-sync/scripts/check_network.py` — без логина проверяет DNS + HTTPS до `sso.garmin.com`, `diauth.garmin.com`, `mobile.integration.garmin.com`, `connectapi.garmin.com`, `connect.garmin.com` (код ответа/таймаут по каждому). Запускается первым на любой машине.
- `garmin-sync/scripts/login.py` — после `api.login()` проверять, что `garmin_tokens.json` реально появился; если нет — понятная ошибка «DI-токен не получен, вероятно diauth.garmin.com недоступен из этой сети», а не ложное «Готово».
- `garmin-sync/README.md` — раздел «Шаг 1 на VPS» вместо Windows: одноразовый контейнер без Dokploy, тот же путь данных, что потом смонтируем в Dokploy:
  ```bash
  git clone -b claude/wonderful-goodall-3j8vju https://github.com/eks1985/bekbek.git ~/bekbek && cd ~/bekbek/garmin-sync
  docker run -it --rm -v "$PWD":/app -v /opt/garmin-sync/data:/data -w /app \
    -e GARMIN_TOKEN_DIR=/data/tokens -e GARMIN_FIT_DIR=/data/fit python:3.12-slim \
    sh -c "pip install -q -r requirements.txt && python -m scripts.check_network && python -m scripts.login && python -m scripts.try_download"
  ```
  Скачанный `.fit` забрать на ПК (`scp vps:/opt/garmin-sync/data/fit/<id>.fit .`) и прогнать `npx tsx scripts/parse-fit.ts … --workout auto`.
- Между попытками входа ждать несколько минут: SSO Garmin за частые входы отвечает 429/427.

**Проверка:** на VPS `check_network` — все хосты отвечают; `login` пишет `garmin_tokens.json`; `try_download` показывает список и скачивает файл; парсер bek-bek разбирает его. Если и с VPS `diauth`/`mobile.integration` недоступны — разбираемся с сетью VPS до шага 2.

### Шаг 2. SQLite и идемпотентная синхронизация (всё ещё CLI)
`app/store.py` (схема + запросы на `sqlite3` из stdlib), `app/sync.py` (`sync_once()`: список → новые id → скачать → записать; ошибка одной активности не валит остальные, `status=failed`, `attempts+1`), `scripts/sync_cli.py`.
- **Проверка:** первый запуск качает N файлов, второй — 0; удалить один `.fit`-файл/строку → третий запуск докачивает ровно его; активности раньше `GARMIN_IMPORT_FROM` не качаются.

### Шаг 3. HTTP-обёртка FastAPI локально
`app/main.py`: эндпоинты выше, bearer-проверка, `asyncio.Lock` + троттлинг `SYNC_MIN_INTERVAL_SEC=60`, синхронный `garminconnect` — через `run_in_threadpool`.
- **Проверка (curl):** без токена — 401; `POST /sync` дважды подряд — второй `throttled:true`; `GET /activities` — список; `GET /activities/{id}/fit` → файл с тем же sha256.

### Шаг 4. Docker + Dokploy
`garmin-sync/Dockerfile` (python:3.12-slim, uvicorn), `.dockerignore`, `garmin-sync/README.md` (деплой, первый логин, переменные). В Dokploy: приложение из этого репо, Build Path `garmin-sync`, volume → `/data`, домен + HTTPS, env: `GARMIN_SYNC_TOKEN`, `GARMIN_TOKEN_DIR=/data/tokens`, `GARMIN_DB_PATH=/data/garmin.db`, `GARMIN_FIT_DIR=/data/fit`, `GARMIN_IMPORT_FROM=<дата>`. Первый вход — `docker exec -it <контейнер> python -m scripts.login` (токены лягут на volume и переживут редеплой).
- **Проверка:** `curl https://<домен>/health` извне; `POST /sync` с токеном работает с VPS (значит, Garmin пускает немецкий IP); редеплой не теряет токены и SQLite.

### Шаг 5. Проверка связи Layero → VPS (до основной логики bek-bek) — код готов (2026-11-02), прод-проверка — после деплоя
В bek-bek: `src/lib/garmin/client.ts` (fetch к сервису с bearer, таймауты, `server-only`) и `GET /api/garmin/status` (только для сессии владельца) → проксирует `/health`. Env в Layero: `GARMIN_SYNC_URL`, `GARMIN_SYNC_TOKEN`, `GARMIN_OWNER_EMAIL`. Пуш в main = деплой — только с подтверждения пользователя.
- **Проверка:** на https://bek-bek.layero.app/api/garmin/status приходит ответ сервиса, время ответа разумное. Если не проходит — переключаемся на push-вариант (сервис POST-ит в bek-bek) до того, как писать шаг 7.
- Локально (одноразовый Postgres на VPS, `npx prisma migrate deploy`, `next dev`): без сессии — 401; сессия владельца (email = `GARMIN_OWNER_EMAIL`) — 200 с реальным ответом сервиса (`garmin_logged_in:true`, `response_ms:76`); сессия другого пользователя — 401. Настоящая проверка связи Layero(РФ) → VPS(DE) — только после деплоя на прод (нужны env `GARMIN_SYNC_URL`/`GARMIN_SYNC_TOKEN`/`GARMIN_OWNER_EMAIL` в Layero и пуш в main с подтверждения пользователя).

### Шаг 6. bek-bek: миграция и общий код сохранения файла — готово (2026-11-02), миграция на прод — при деплое
- `prisma/schema.prisma`, модель `FitFile`: `source String @default("upload")` (`upload` | `garmin`), `garminActivityId String?`, `@@unique([userId, garminActivityId])`. Чистое добавление → по README сначала `db:deploy` на прод (с подтверждения), потом код.
- `src/lib/fit-files/upload.ts`: вынести тело после чтения байтов в `saveFitBytes(userId, bytes, originalName, extra?: {source, garminActivityId})`; `uploadFitFile(File)` становится тонкой обёрткой. Поведение ручной загрузки не меняется.
- **Проверка:** локально `npm run db:migrate`, ручная загрузка FIT работает как раньше, lint/tsc зелёные.
- Прогнано на одноразовом Postgres + s3rver (без доступа к реальному S3-бакету — он общий с продом, трогать не стали): миграция (через `prisma migrate diff` + `migrate deploy`, `migrate dev` тут неинтерактивен) применилась; ручная загрузка сэмпла из `samples/` вернула тот же формат ответа, что раньше; повторная загрузка того же файла — 409; в БД `source="upload"`, `garminActivityId=null`. `tsc --noEmit`/`eslint` — чисто (кроме трёх старых ошибок про `RouteContext`/`PageProps`/`LayoutProps` — это типы Next, которых нет до первого `next dev`/`build`, не связаны с этой правкой).

### Шаг 7. bek-bek: импорт `POST /api/garmin/sync` — готово (2026-11-02)
`src/lib/garmin/import.ts`: `syncFromGarmin(userId)` → `POST /sync` сервиса → `GET /activities` → вычесть `garminActivityId`, уже лежащие в `fit_files` пользователя → для каждой новой (лимит ~5 за вызов, из-за таймаута serverless) `GET /fit` → `saveFitBytes(..., {source:"garmin", garminActivityId})`; 409 по sha256 → `update` существующей строки `garminActivityId`. Route `src/app/api/garmin/sync/route.ts`: только сессия, только `GARMIN_OWNER_EMAIL`; ответ `{imported, skipped, errors, more}`.
- **Проверка:** вызвать вручную (curl с cookie / временная кнопка) — новая тренировка появилась в списке и разобрана; повторный вызов → `imported: 0`; тренировка, ранее загруженная руками, не задвоилась.
- Прогнано против настоящего задеплоенного сервиса (`garmin.terravitafze.com`), БД — одноразовый Postgres, S3 — s3rver (реальный бакет не трогали): 4 вызова по 5 — все 20 активностей импортированы, `more:true/true/true/false`; 5-й вызов — `imported:0`; сценарий «файл уже загружен руками» — удалил Garmin-строку, залил те же байты руками (`source:"upload"`), повторный sync — `imported:1`, но строка в БД осталась одна, `garminActivityId` привязался к уже существующей (`source` остался `"upload"`), не задвоилось.

### Шаг 8. Автозапуск при открытии dashboard — готово (2026-11-02)
Клиентский компонент `src/components/garmin/garmin-sync-on-open.tsx` в `src/app/dashboard/page.tsx`: после монтирования шлёт `POST /api/garmin/sync` (страница отрисовывается сразу, не ждёт Garmin), показывает «Проверяю Garmin…», при `imported > 0` — toast (sonner) и `router.refresh()`; при `more:true` — повторный вызов.
- **Проверка:** пробежка → через пару минут открыть bek-bek → тренировка появляется сама; повторное открытие не создаёт дублей.
- Компонент рендерится в dashboard только владельцу (`user.email === GARMIN_OWNER_EMAIL`, проверка серверная в `page.tsx`) — curl SSR-страницы подтвердил: у владельца в HTML есть «Проверяю Garmin…», у другого залогиненного пользователя блока нет вовсе (и запроса к сервису он не делает). Повторный вызов `/api/garmin/sync`, как при повторном открытии dashboard, — `imported:0`, число файлов не изменилось (дедуп на шаге 7 это и обеспечивает). Настоящую проверку «пробежка → tренировка появилась сама» делать в браузере пока негде (это VPS, не рабочий ПК) — логика идентична уже работающему `fit-upload.tsx` (toast + `router.refresh()`), финально проверим после деплоя.

### Шаг 9 (потом, по желанию)
Фоновый опрос в сервисе раз в 10–15 мин (файл готов до открытия bek-bek); догрузка истории пачками с паузами; MCP-инструмент `sync_garmin`; несколько пользователей. Если когда-нибудь появится удаление тренировок в bek-bek — оставлять «надгробие» по `garminActivityId`, иначе удалённая тренировка вернётся при следующей синхронизации.

## Обновление токена Garmin, когда он протухнет — вариант А реализован (2026-11-02)

`garminconnect` выдаёт DI-токен и refresh-токен, которые живут примерно год и обновляются сами на каждом запросе — пока они живы, вход руками не нужен. Когда год пройдёт, токен умрёт: `connect()` в `app/garmin_client.py` начнёт бросать `NotLoggedInError`, это сразу видно как `garmin_logged_in: false` в `GET /health` и — через `/api/garmin/status` (шаг 5) — в самом bek-bek. Сейчас обновить токен можно только руками на VPS (`python -m scripts.login`, пароль и код MFA с клавиатуры). Пока пользователь один — не блокер, но раз в год вспоминать, как заходить на VPS, неудобно. Хотим самостоятельное обновление без ssh/docker exec.

**Вариант А — маленькая защищённая страница прямо на garmin-sync (рекомендуется для старта).** `garminconnect` после `api.login()` возвращает либо сразу успех, либо `needs_mfa` — тогда код подтверждается вторым вызовом `api.resume_login(code)`. Это укладывается в два HTTP-эндпоинта: `POST /auth/start {email, password}` (держит `Garmin`-клиент в памяти процесса по `attempt_id` с коротким TTL, если нужен MFA) и `POST /auth/finish {attempt_id, code}` (дозаписывает токены в `TOKEN_DIR/garmin_tokens.json`, как сейчас делает `scripts/login.py`). Сверху — одна HTML-страница на `GET /auth` (чистый `<form>` + `fetch`, без фреймворка). Защита — тот же `GARMIN_SYNC_TOKEN`, второй секрет не плодим. Путь пароля: браузер → VPS → Garmin, bek-bek/Layero вообще не участвуют; нет риска таймаута serverless-функций bek-bek на небыстром Garmin SSO (задержки до 30 с мы уже видели на шаге 1).

**Вариант Б — форма в самом bek-bek, которая пересылает пароль на VPS.** Те же `/auth/start`/`/auth/finish` на garmin-sync, но вызывает их не браузер пользователя, а bek-bek: страница в `/dashboard` (видна только владельцу, как автосинк из шага 8) с формой → `POST /api/garmin/login` и `/api/garmin/login/mfa` в bek-bek → эти роуты дёргают VPS с уже известным сервером `GARMIN_SYNC_TOKEN` (пользователю токен вводить не нужно). Плюс — привычный интерфейс на одном домене; минус — пароль лишний раз идёт через Layero (не хранится, не логируется, но путь длиннее), и серверная функция bek-bek ждёт ответ VPS — риск упереться в таймаут, если Garmin SSO тормозит именно в этот момент.

**Мониторинг, независимо от выбора:** отдельный алертинг не нужен — `garmin_logged_in:false` уже виден в `/api/garmin/status`, достаточно изредка проверять или (потом, по желанию) прикрутить уведомление на смену флага.

**Реализация варианта А:** `app/garmin_client.py` — `start_login(email, password)` (вызывает `Garmin(..., return_on_mfa=True).login()`; без MFA сразу сохраняет и проверяет токены через `_dump_and_verify`, с MFA возвращает `client_state`) и `finish_login(client_state, code)` (новый `Garmin()` + `resume_login`, та же проверка). `app/main.py` — `POST /auth/start`/`POST /auth/finish` под тем же `Authorization: Bearer <GARMIN_SYNC_TOKEN>`, что и остальной API; незавершённые входы (ждут MFA) — в памяти процесса, `attempt_id` → `client_state`, TTL 5 минут. `GET /auth` — одна HTML-страница (без фреймворка, inline `<script>`), сама без авторизации (ничего не хранит и не раскрывает), токен сервиса пользователь вводит в поле на странице при каждом визите — так секрет не попадает в URL/логи.
- **Проверка:** в одноразовом контейнере — `GET /auth` отдаёт форму без авторизации (200); `/auth/start`/`/auth/finish` без токена — 401; `/auth/start` с токеном и заведомо несуществующим email/паролем реально дошёл до Garmin SSO и вернул `401 Unauthorized (Invalid Username or Password)` как `400` с понятным `detail` (не трогая настоящий аккаунт и его лимит попыток); `/auth/finish` с чужим `attempt_id` — `400` «попытка не найдена или истекла»; существующие токены и `/health` после всех проверок не изменились. Полный проход с реальным паролем и MFA — не прогонял (реальный вход расходует лимит попыток Garmin и не нужен, пока текущий токен жив); пользователь может проверить сам в любой момент на `https://garmin.terravitafze.com/auth`.

**Рекомендация:** вариант А — меньше кода, весь в `garmin-sync/` (bek-bek не трогаем), ничего нового не доверяем Layero, не рискует таймаутом serverless. Вариант Б можно сделать позже как более дружелюбную обёртку сверху того же API (например, просто ссылка на `/auth` из dashboard bek-bek, без переписывания бэкенда).

**E2e-проверка варианта А на проде (2026-11-03):** протестировали вживую — переименовал `garmin_tokens.json` на VPS (имитация протухания), `/health` и `/api/garmin/status` в bek-bek сразу показали `garmin_logged_in:false`; владелец прошёл реальный вход на `/auth` (без MFA, один запрос `/auth/start`), токены пересохранились, `POST /sync` снова заработал. Заодно обнаружился пробел: `GarminSyncOnOpen` глотает 503 от `/sync` молча (специально, чтобы не мешать обычному показу уже загруженных файлов) — на dashboard никакого сигнала о протухании не было. Это и стало поводом для баннера ниже.

**Баннер на dashboard + вход без ручного токена (2026-11-03).** На VPS добавлена короткоживущая (10 мин) HMAC-подписанная ссылка: `app/main.py` — `require_token_or_link` (отдельная зависимость только для `/auth/start`/`/auth/finish`) принимает либо точный `GARMIN_SYNC_TOKEN`, либо `<exp_unix>.<hmac>`, подписанный тем же секретом (`hmac.compare_digest`, без нового общего секрета между сервисами). `GET /auth`: если в адресе есть `?link=...` — поле «Токен сервиса» скрывается, подпись уходит как Bearer напрямую; без него — прежнее ручное поле. `AUTH_RETURN_URL` (env) встраивается в страницу при старте процесса — после успеха редирект обратно в bek-bek через ~1.5 с (если не задан — просто «Готово», страница остаётся рабочей сама по себе). В bek-bek: `buildGarminAuthLink()` в `src/lib/garmin/client.ts` (та же формула HMAC, `node:crypto`), `GarminStatusBanner` — серверный компонент на dashboard (только у владельца, как и автосинк): если `garmin_logged_in:false` — баннер и ссылка с подписью; на ошибке/таймауте проверки — молча ничего не рендерит, dashboard не роняем.
- **Проверка:** подписи Python (`hmac.new`) и Node (`createHmac`) с одинаковым `exp`/секретом совпали побайтово. На одноразовом контейнере (без реальных Garmin-токенов) — валидная ссылка с фейковыми Garmin-кредами реально дошла до SSO и вернула `400` (значит, зависимость её приняла); просроченная ссылка, неверная подпись и пустой `Authorization` — `401`; обычный `GARMIN_SYNC_TOKEN` по-прежнему работает. Остальные роуты (`/health`, `/sync`, `/activities*`) подписанную ссылку не принимают — только точный токен. В bek-bek (одноразовые Postgres + `next dev`, `GARMIN_SYNC_URL` указывал на тестовый контейнер без токенов): у владельца баннер и корректно подписанная ссылка в HTML dashboard, у обычного пользователя баннера нет вовсе; ссылку, собранную dashboard'ом, напрямую проверил curl'ом против тестового сервиса — тоже дошла до Garmin SSO.

## Несколько пользователей Garmin — реализовано (2026-11-03)

Сейчас garmin-sync обслуживает ровно одного пользователя: один Garmin-аккаунт, один `TOKEN_DIR/garmin_tokens.json`, SQLite без колонки пользователя, доступ в bek-bek гейтится единственным `GARMIN_OWNER_EMAIL`. На будущее — что нужно поменять, чтобы несколько разных людей в bek-bek подключили каждый свой Garmin-аккаунт. Предположение (если понадобится другое — поправить на месте): «несколько пользователей» = несколько независимых bek-bek-аккаунтов, у каждого свой отдельный Garmin-аккаунт, не общий на всех и не разные вьюхи одних данных.

**SQLite — не узкое место само по себе.** Один процесс uvicorn, запись раз в минуту на пользователя максимум (троттлинг уже есть), короткоживущие соединения на запрос — это выдержит десятки пользователей без проблем. Единственная реальная причина завести `PRAGMA journal_mode=WAL` — чуть меньше блокировок при одновременных читателе/писателе, это дёшево сделать уже сейчас независимо от многопользовательности. Настоящее узкое место — не БД, а то, что весь сервис спроектирован на ровно один Garmin-аккаунт (один `TOKEN_DIR`, нет понятия «чей» запрос). Переходить на Postgres имеет смысл только если пользователей станет действительно много (десятки активных одновременно) — для личного/семейного масштаба явно преждевременно.

**Что меняется в garmin-sync:**
- Пути по `user_id`: `TOKEN_DIR/<user_id>/garmin_tokens.json`, `FIT_DIR/<user_id>/<activity_id>.fit`.
- `app/store.py`: `activities` — составной PK `(user_id, activity_id)`; `meta` — составной ключ `(user_id, key)` (сейчас `last_sync_at` общий на весь сервис, должен стать per-user). Включить `PRAGMA journal_mode=WAL`.
- `app/main.py`: все роуты получают сегмент пользователя — `POST /users/{user_id}/sync`, `GET /users/{user_id}/activities`, `GET /users/{user_id}/activities/{id}/fit`, `POST /users/{user_id}/auth/start`, `POST /users/{user_id}/auth/finish`. `GARMIN_SYNC_TOKEN` остаётся общим секретом между bek-bek и сервисом — это доверие к bek-bek как к серверу, а не к конкретному человеку; bek-bek сам знает своего текущего пользователя и передаёт его `user_id`.
- Троттлинг и `_sync_lock` — сейчас один глобальный, должен стать словарём по `user_id` (иначе синк одного человека троттлит другого без всякой связи между их Garmin-аккаунтами).
- Подписанная ссылка на `/auth` (уже реализована) — HMAC сейчас только по `exp`, должен стать по `"<user_id>:<exp>"`, иначе чужую ссылку можно переиспользовать для входа в произвольный `user_id`.

**Что меняется в bek-bek:**
- `GARMIN_OWNER_EMAIL`/`isGarminOwner` исчезают из всего кода (`dashboard/page.tsx` и так далее) — доступ получает любой залогиненный пользователь, каждый работает только в своём `user.id`, отдельный флаг-разрешение не нужен (изоляция естественная, через путь запроса).
- `fit_files.garminActivityId` в Prisma уже объявлен per-user (`@@unique([userId, garminActivityId])`, шаг 6) — тут менять ничего не нужно, предусмотрели заранее.
- `src/lib/garmin/client.ts` (`garminFetch`, `buildGarminAuthLink`), `src/lib/garmin/import.ts`, `garmin-sync-on-open.tsx`, `garmin-status-banner.tsx` — везде добавить `user.id` в путь запроса и в payload подписи ссылки.

**Миграция существующих данных:** решили не делать — приложение в тесте, данные не важны. Вместо миграции перед реальной эксплуатацией зачищаем `/opt/garmin-sync/data` (токены, `garmin.db`, `.fit`) и прод-таблицу `fit_files` в bek-bek с нуля; каждый из 3-5 пользователей потом просто проходит `/users/<user_id>/auth` сам, своим Garmin-логином.

**Что не меняется:** вход в Garmin как был — один вызов `garminconnect` на человека, общей сессии между пользователями нет и не нужно; лимиты Garmin на частые повторные входы (429/427) относятся к одному аккаунту, добавление пользователей не повышает этот риск — каждый логинится в свой аккаунт независимо.

**Реализация:** всё по брейнштормовому плану выше, без отклонений. `app/store.py` — составные PK `(user_id, activity_id)`/`(user_id, key)`, `PRAGMA journal_mode=WAL`. `app/garmin_client.py` — `connect`/`start_login`/`finish_login`/`_dump_and_verify` принимают `token_dir` явно (убрали глобальный `TOKEN_DIR` из модуля). `app/sync.py` — `sync_once(user_id)`. `app/main.py` — все роуты под `/users/{user_id}/...`, кроме общего `GET /health` (теперь просто `{"ok": true}`, живость процесса без привязки к пользователю); `_sync_locks` — словарь `asyncio.Lock` по `user_id`; `_PENDING_LOGINS` хранит ещё и `user_id`, `/auth/finish` сверяет его с путём; HMAC ссылки — подпись по `f"{user_id}:{exp}"`; HTML-страница одна и та же для всех — JS берёт `user_id` из `location.pathname`. Вспомогательные CLI (`scripts/login.py`, `try_download.py`, `sync_cli.py`) тоже приняли `user_id` первым аргументом. В bek-bek — `GARMIN_OWNER_EMAIL`/`isGarminOwner` убраны полностью (из `dashboard/page.tsx`, обоих API-роутов `/api/garmin/*`), баннер и автосинк теперь для любого залогиненного; `client.ts`/`import.ts` везде принимают `userId`.
- **Проверка:** в одноразовом контейнере (без реальных Garmin-токенов) — `GET /health` → `{"ok":true}`; `GET /users/alice/health` и `/users/bob/health` оба `garmin_logged_in:false` независимо; подписанная ссылка Алисы (`alice:<exp>`) прошла до Garmin SSO на `/users/alice/auth/start` (фейковые креды → `400` с ошибкой Garmin, т.е. зависимость пропустила), та же ссылка на `/users/bob/auth/start` — `401`; `PRAGMA journal_mode` вернул `wal`, файлы `-wal`/`-shm` на месте. В bek-bek (одноразовые Postgres + `next dev`, без `GARMIN_OWNER_EMAIL` в env, `GARMIN_SYNC_URL` на тестовый контейнер) — две сессии (alice@example.com, bob@example.com): у обоих баннер «Garmin отключён» и автосинк «Проверяю Garmin…», ссылки в HTML с разными `user_id` (их реальными `userId` из БД) и разными подписями; ссылку, собранную для Алисы на dashboard, напрямую curl'ом проверил против обоих `user_id` на тестовом сервисе — тот же результат (своя проходит до Garmin, чужая — 401).

**Перед реальной эксплуатацией (ещё не сделано):** зачистить на VPS `/opt/garmin-sync/data/{tokens,fit}/*` и `garmin.db` (пересоздастся сам, схема уже новая), на проде bek-bek — таблицу `fit_files` (и `workouts` каскадом); добавить реальных пользователей и провести каждому `/users/<user_id>/auth`.

## Подгрузка истории — кнопка «+10 тренировок» (2026-11-03)

Контекст: обычный `/sync` смотрит только последние `LIST_LIMIT` (20) активностей — старые тренировки, загруженные на часы раньше, так и не подтягиваются. Нужен способ постепенно дотянуть историю, управляемый самим пользователем, а не одним большим импортом разом.

**garmin-sync:** `app/garmin_client.py` — `list_range(api, start, limit)` (обёртка над `api.get_activities(start, limit)` с произвольным смещением; `list_recent` теперь `list_range(api, 0, limit)`). `app/sync.py` — `sync_history(user_id, count=10)`: смещение хранится в `meta.history_offset` (по умолчанию `LIST_LIMIT`, чтобы не повторять окно обычного синка), продвигается на `len(batch)` при каждом вызове; `GARMIN_IMPORT_FROM` сознательно не учитывает — это и есть цель кнопки. Общий код скачивания одной активности вынесен в `_download_one()` (переиспользуют и `sync_once`, и `sync_history`). `app/main.py` — `POST /users/{user_id}/sync/history?count=N`: тот же per-user `lock`, что у обычного `/sync`, но без троттлинга по времени (явное действие пользователя, не автоматика).

**bek-bek:** `client.ts` — `triggerGarminHistorySync(userId, count)`. `import.ts` — общий хвост `importKnownActivities(userId, limit)` вынесен из `syncFromGarmin` (лимит 5, как раньше — для автосинка на serverless) и переиспользован в новой `importGarminHistory(userId, count=10)` (лимит 10 — скачивание одного файла с VPS занимает доли секунды, таймаут serverless не грозит). Роут `POST /api/garmin/history`, кнопка `GarminHistoryButton` (клиентский компонент, toast + `router.refresh()`) в шапке `FitFileList` через `CardAction`.

**Заодно починили сортировку ленты:** `listFitFiles` сортировала по `uploadedAt` (когда файл загружен в bek-bek) — после появления подгрузки истории старые тренировки, скачанные только что, лезли бы в начало списка. Теперь сортировка по `workout.startTime` (дата самой тренировки). Отсортировать в самом Prisma-запросе через связь не вышло: `orderBy: { workout: { startTime: { sort: "desc", nulls: "last" } } }` Prisma отклоняет — модификатор `nulls` работает только на nullable-колонках, а `Workout.startTime` обязательное (NULL там только из-за отсутствующей связи). Сортируем в JS после выборки: `aTime ?? -Infinity` — так файлы без разбора гарантированно уходят в конец независимо от особенностей `NULLS FIRST/LAST` у конкретной СУБД.
- **Проверка:** `POST /users/<id>/sync/history` без токена — `401`; с токеном, но без входа в Garmin — `503` (как у обычного `/sync`); `?count=25` принимается, не падает на парсинге. Сортировка — тестовые записи в одноразовом Postgres (тренировка 2026-11-01, загружена давно; тренировка 2020-01-01, «загружена» только что — имитация подгрузки истории; файл без разбора): прямой Prisma-запрос с `orderBy` по связи поставил неразобранный файл первым (Postgres `NULLS FIRST` для `DESC` по умолчанию) — заметили и переделали на сортировку в JS; с ней порядок на реальной отрендеренной странице dashboard (curl по cookie) — недавняя тренировка, потом 2020 год, неразобранный файл в конце, как и требовалось.

## Файлы

- Новое: `garmin-sync/` (Python-сервис), `src/lib/garmin/client.ts`, `src/lib/garmin/import.ts`, `src/app/api/garmin/status/route.ts`, `src/app/api/garmin/sync/route.ts`, `src/components/garmin/garmin-sync-on-open.tsx`, новая папка миграции.
- Меняется: `prisma/schema.prisma`, `src/lib/fit-files/upload.ts`, `src/app/dashboard/page.tsx`, `.env.example`, `README.md`.
- Переиспользуем: `isFitFile`/sha256/S3/парсинг из `upload.ts`, `putObject` из `src/lib/storage/s3.ts`, `workoutRow` из `src/lib/workouts/to-row.ts`, `requireUser`/`getSession` из `src/lib/auth/session.ts`.

## Правила репо, которые соблюдаем
Коммиты по-русски без префиксов; разработка в ветке `claude/wonderful-goodall-3j8vju`; миграции на прод и пуш в main — только с подтверждения пользователя; миграция-добавление идёт раньше кода.
