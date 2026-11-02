# Импорт тренировок из Garmin Connect через Python-сервис на VPS

## Контекст

Сейчас FIT-файлы в bek-bek попадают только ручной загрузкой (`POST /api/fit-files` → `uploadFitFile()` в `src/lib/fit-files/upload.ts`: проверка, sha256-дедуп, файл в Selectel S3, разбор `parseWorkout(..., {workout:"auto"})`, строки `fit_files` + `workouts`).
Хочется, чтобы тренировка, появившаяся в Garmin Connect, через пару минут без участия пользователя оказывалась в bek-bek. bek-bek живёт на Layero (serverless, РФ), Garmin Connect из РФ ходить неудобно, поэтому рядом ставим маленький Python-сервис на немецком VPS (Dokploy) на библиотеке `garminconnect`.

Решения, принятые с пользователем: код сервиса — папка `garmin-sync/` в этом репо; импорт только новых тренировок (с даты из настройки); один аккаунт Garmin — владельца, привязан к одному email в bek-bek.

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

### Шаг 5. Проверка связи Layero → VPS (до основной логики bek-bek)
В bek-bek: `src/lib/garmin/client.ts` (fetch к сервису с bearer, таймауты, `server-only`) и `GET /api/garmin/status` (только для сессии владельца) → проксирует `/health`. Env в Layero: `GARMIN_SYNC_URL`, `GARMIN_SYNC_TOKEN`, `GARMIN_OWNER_EMAIL`. Пуш в main = деплой — только с подтверждения пользователя.
- **Проверка:** на https://bek-bek.layero.app/api/garmin/status приходит ответ сервиса, время ответа разумное. Если не проходит — переключаемся на push-вариант (сервис POST-ит в bek-bek) до того, как писать шаг 7.

### Шаг 6. bek-bek: миграция и общий код сохранения файла
- `prisma/schema.prisma`, модель `FitFile`: `source String @default("upload")` (`upload` | `garmin`), `garminActivityId String?`, `@@unique([userId, garminActivityId])`. Чистое добавление → по README сначала `db:deploy` на прод (с подтверждения), потом код.
- `src/lib/fit-files/upload.ts`: вынести тело после чтения байтов в `saveFitBytes(userId, bytes, originalName, extra?: {source, garminActivityId})`; `uploadFitFile(File)` становится тонкой обёрткой. Поведение ручной загрузки не меняется.
- **Проверка:** локально `npm run db:migrate`, ручная загрузка FIT работает как раньше, lint/tsc зелёные.

### Шаг 7. bek-bek: импорт `POST /api/garmin/sync`
`src/lib/garmin/import.ts`: `syncFromGarmin(userId)` → `POST /sync` сервиса → `GET /activities` → вычесть `garminActivityId`, уже лежащие в `fit_files` пользователя → для каждой новой (лимит ~5 за вызов, из-за таймаута serverless) `GET /fit` → `saveFitBytes(..., {source:"garmin", garminActivityId})`; 409 по sha256 → `update` существующей строки `garminActivityId`. Route `src/app/api/garmin/sync/route.ts`: только сессия, только `GARMIN_OWNER_EMAIL`; ответ `{imported, skipped, errors, more}`.
- **Проверка:** вызвать вручную (curl с cookie / временная кнопка) — новая тренировка появилась в списке и разобрана; повторный вызов → `imported: 0`; тренировка, ранее загруженная руками, не задвоилась.

### Шаг 8. Автозапуск при открытии dashboard
Клиентский компонент `src/components/garmin/garmin-sync-on-open.tsx` в `src/app/dashboard/page.tsx`: после монтирования шлёт `POST /api/garmin/sync` (страница отрисовывается сразу, не ждёт Garmin), показывает «Проверяю Garmin…», при `imported > 0` — toast (sonner) и `router.refresh()`; при `more:true` — повторный вызов.
- **Проверка:** пробежка → через пару минут открыть bek-bek → тренировка появляется сама; повторное открытие не создаёт дублей.

### Шаг 9 (потом, по желанию)
Фоновый опрос в сервисе раз в 10–15 мин (файл готов до открытия bek-bek); догрузка истории пачками с паузами; MCP-инструмент `sync_garmin`; несколько пользователей. Если когда-нибудь появится удаление тренировок в bek-bek — оставлять «надгробие» по `garminActivityId`, иначе удалённая тренировка вернётся при следующей синхронизации.

## Файлы

- Новое: `garmin-sync/` (Python-сервис), `src/lib/garmin/client.ts`, `src/lib/garmin/import.ts`, `src/app/api/garmin/status/route.ts`, `src/app/api/garmin/sync/route.ts`, `src/components/garmin/garmin-sync-on-open.tsx`, новая папка миграции.
- Меняется: `prisma/schema.prisma`, `src/lib/fit-files/upload.ts`, `src/app/dashboard/page.tsx`, `.env.example`, `README.md`.
- Переиспользуем: `isFitFile`/sha256/S3/парсинг из `upload.ts`, `putObject` из `src/lib/storage/s3.ts`, `workoutRow` из `src/lib/workouts/to-row.ts`, `requireUser`/`getSession` из `src/lib/auth/session.ts`.

## Правила репо, которые соблюдаем
Коммиты по-русски без префиксов; разработка в ветке `claude/wonderful-goodall-3j8vju`; миграции на прод и пуш в main — только с подтверждения пользователя; миграция-добавление идёт раньше кода.
