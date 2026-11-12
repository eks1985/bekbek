# garmin-sync — загрузка тренировок из Garmin Connect

Маленький Python-сервис на VPS (Dokploy). Забирает оригинальные FIT-файлы
из Garmin Connect, а bek-bek потом забирает их у него по HTTPS. В S3 сервис
не пишет: немецкий VPS не дотягивается до российского Selectel, поэтому
файл в бакет кладёт сам bek-bek, как при ручной загрузке.

Библиотека — [`garminconnect`](https://github.com/cyberjunky/python-garminconnect)
0.3.x (без garth; токены в `garmin_tokens.json`, обновляются сами).

Готовы шаги 1–4 (см. PLAN.md): прототип на VPS, SQLite-синхронизация, HTTP API
и деплой в Dokploy — https://garmin.terravitafze.com. Сервис многопользовательский:
у каждого пользователя bek-bek — свой Garmin-аккаунт, данные разделены по `user_id`
(обычно это `userId` из базы bek-bek) — см. «Что где лежит».

## Шаг 1 — на VPS, не на ПК

С ПК в РФ вход не проходит: пароль Garmin принимает (`sso.garmin.com`), но обмен
тикета на токен (`diauth.garmin.com`) висит до таймаута, а без этого токена
сохранить нечего. Поэтому всё, что ходит в Garmin, запускаем на немецком VPS.
Строка `Could not resolve host: mobile.integration.garmin.com` в логе — не
проблема: такого имени в DNS нет вообще, это служебный адрес тикета.

На VPS (Docker там уже есть — его ставит Dokploy). Данные — в
`/opt/garmin-sync/data`, эту же папку потом подключим к контейнеру в Dokploy,
и токены не придётся получать заново.

```bash
git clone -b claude/wonderful-goodall-3j8vju https://github.com/eks1985/bekbek.git ~/bekbek
```

```bash
cd ~/bekbek/garmin-sync && docker run -it --rm -v "$PWD":/app -v /opt/garmin-sync/data:/data -w /app -e GARMIN_TOKEN_DIR=/data/tokens -e GARMIN_FIT_DIR=/data/fit -e PYTHONDONTWRITEBYTECODE=1 python:3.12-slim bash
```

Дальше — внутри контейнера, по одной команде:

```bash
python -m scripts.check_network        # все хосты должны быть OK; иначе дальше не идём
pip install -q -r requirements.txt
python -m scripts.login <user_id>              # email, пароль, код MFA → /data/tokens/<user_id>/garmin_tokens.json
python -m scripts.try_download <user_id>       # 10 последних активностей + FIT последней
python -m scripts.try_download <user_id> 24300728659   # или конкретная по id
exit
```

Между неудачными попытками входа ждите несколько минут: за частые входы SSO
Garmin отвечает 429/427.

Проверка файла парсером bek-bek — на ПК, из корня репо:

```powershell
scp <vps>:/opt/garmin-sync/data/fit/<activityId>.fit garmin-sync/data/
npx tsx scripts/parse-fit.ts garmin-sync/data/<activityId>.fit --workout auto
```

Итоги в JSON (дистанция, время, круги) должны совпасть с тем, что видно в Garmin Connect.

## Шаг 4 — деплой в Dokploy

Приложение в Dokploy (VPS, http://2.29.21.51:3000), проект `garmin`, собирается
из этого репо: Build Path `garmin-sync`, Dockerfile `./Dockerfile` (uvicorn,
порт 8000). Volume — bind mount `/opt/garmin-sync/data` → `/data`: токены,
SQLite (`garmin.db`) и `.fit`-файлы переживают редеплой. Домен
`garmin.terravitafze.com` + Let's Encrypt (wildcard DNS `*.terravitafze.com`
уже смотрит на VPS).

Переменные окружения в Dokploy:

```
GARMIN_SYNC_TOKEN=<общий секрет с bek-bek>
GARMIN_TOKEN_DIR=/data/tokens
GARMIN_FIT_DIR=/data/fit
GARMIN_DB_PATH=/data/garmin.db
GARMIN_IMPORT_FROM=2026-09-01   # качать активности с этой даты
AUTH_RETURN_URL=https://bek-bek.layero.app/dashboard   # куда вернуть после входа на /auth
```

Первый вход Garmin — проще через `/users/<user_id>/auth` в браузере (см. ниже)
или руками, если токенов для этого `user_id` ещё нет на volume:

```bash
docker exec -it <контейнер> python -m scripts.login <user_id>
```

Проверка после деплоя: `curl https://garmin.terravitafze.com/health` →
`{"ok":true}` (жив процесс); `curl .../users/<user_id>/health` →
`garmin_logged_in:true` для уже вошедших; `POST /users/<user_id>/sync` с
токеном качает новое; редеплой не теряет токены и SQLite.

## Вход и обновление токена самостоятельно (без ssh на VPS)

Каждый пользователь bek-bek подключает свой Garmin-аккаунт сам, без участия
админа. Токен Garmin живёт примерно год; когда протухнет (или ещё не заведён),
на dashboard bek-bek появляется баннер «Garmin отключён» со ссылкой на
`/users/<user_id>/auth` — переходите по ней, вводите email и пароль Garmin
(и код MFA, если попросит), после успеха страница сама возвращает в bek-bek.
Токен сервиса (`GARMIN_SYNC_TOKEN`) вводить не нужно: ссылка с dashboard уже
несёт короткоживущую (10 минут) HMAC-подпись по `"<user_id>:<exp>"` на этом же
секрете — bek-bek и garmin-sync оба его знают, по сети он не передаётся.
Ссылка одного пользователя не подходит для входа в чужой `user_id` (подпись
это проверяет), и годится только для входа (`/auth/start`, `/auth/finish`) —
не даёт доступа к `/sync` или скачиванию тренировок.

Зайти можно и напрямую, минуя bek-bek, — `https://garmin.terravitafze.com/users/<user_id>/auth`
без `?link=...` в адресе покажет поле «Токен сервиса» для ручного ввода (нужно
знать свой `user_id` — это `id` строки пользователя в БД bek-bek).

Пароль (и токен/подпись) уходят только на этот домен (браузер → VPS → Garmin),
Layero в самом входе не участвует — он только генерирует ссылку.

## Что где лежит

Сервис многопользовательский: везде, где это важно, первый сегмент пути —
`/users/{user_id}/...`. `user_id` — произвольная строка, которую передаёт
bek-bek (обычно свой `userId` из БД); регистрировать пользователей заранее
не нужно — каталоги и строки в SQLite создаются лениво, при первом входе
через `/auth`.

- `app/config.py` — настройки из env (пути, секрет, троттлинг, IMPORT_FROM) +
  `token_dir_for(user_id)`/`fit_dir_for(user_id)` — пути на диске per-user.
- `app/garmin_client.py` — вход по токенам (принимает `token_dir` явно), список
  активностей, скачивание ORIGINAL (zip → `.fit`, проверка заголовка `.FIT`).
- `app/store.py` — SQLite: `activities` и `meta` с составным ключом
  `(user_id, ...)`, `PRAGMA journal_mode=WAL`.
- `app/sync.py` — `sync_once(user_id)`: последние `LIST_LIMIT` активностей →
  новое → скачать в `fit_dir_for(user_id)`; `sync_history(user_id, count)` —
  подгрузка более старых порциями (смещение в `meta.history_offset`, без учёта
  `GARMIN_IMPORT_FROM`); ошибка одной активности не валит остальные
  (status=failed, attempts+1).
- `app/main.py` — FastAPI: `GET /health` (живость процесса, без user_id);
  `GET /users/{id}/health`, `POST /users/{id}/sync`, `POST /users/{id}/sync/history?count=N`,
  `POST /users/{id}/history/enable`/`disable`, `GET /users/{id}/history/status`
  (фоновая подгрузка всей истории, см. ниже), `GET /users/{id}/activities`,
  `GET /users/{id}/activities/{activity_id}/fit`, `POST /users/{id}/workouts`
  (создать структурированную тренировку, см. ниже), `GET /users/{id}/auth`
  (страница) + `POST /users/{id}/auth/start`/`finish`.
  Общий `GARMIN_SYNC_TOKEN` на все эндпоинты (доверие к bek-bek-серверу);
  `/auth/start`/`/auth/finish` вдобавок принимают короткоживущую подписанную
  ссылку с dashboard. Троттлинг и lock синка — per-user (словари по `user_id`);
  у `/sync/history` троттлинга по времени нет — явный клик, не автоматика.
  Единственный автономный процесс сервиса — фоновый asyncio-цикл в `lifespan`
  (`_history_loop`): когда у пользователя `history_sync_active=1` в `meta`,
  тянет по одной активности через `sync.sync_history` не чаще, чем раз в
  `HISTORY_TICK_INTERVAL_SEC` (`GARMIN_HISTORY_RATE_PER_HOUR`, по умолчанию
  30/час) — **независимо на каждого пользователя** (per-user таймер в
  `meta.history_last_pull_at`, не общий бюджет на всех — бан Garmin привязан
  к конкретному аккаунту). Делит `_sync_locks`/`meta.history_offset` с ручным
  «+10», ошибка одного пользователя (включая истёкший токен) не роняет цикл
  и не блокирует остальных. Останавливается сам, когда `sync_history` вернёт
  `has_more: false`. Рассчитан строго на одну реплику процесса (см. докстринг
  вверху `main.py`) — при нескольких репликах темп на пользователя удвоится.
- `app/workout_builder.py` — собирает и грузит в Garmin структурированную
  тренировку (только бег) из JSON-схемы конструктора bek-bek (та же модель,
  что в `src/lib/structured-workouts/model.ts`): каждый шаг заканчивается по
  времени, дистанции или кнопке круга. Время/дистанция у `interval` и время у
  `warmup`/`cooldown`/`recovery` — штатными хелперами `garminconnect.workout`;
  дистанция у `warmup`/`cooldown`/`recovery` и кнопка круга у любой роли —
  хелперов нет, шаг собирается вручную (`create_custom_step`, числа
  `displayOrder` равны самим id типов — проверено по исходнику `0.3.20`, не
  угадано). `requirements.txt` держит `garminconnect[workout]` ради pydantic.
- `scripts/check_network.py` — DNS и HTTPS до хостов Garmin, без логина и зависимостей.
- `scripts/login.py <user_id>` — однократный вход по паролю руками, пароль не сохраняется; без DI-токена честно падает.
- `scripts/try_download.py <user_id> [activity_id]` — ручная проверка шага 1.
- `scripts/sync_cli.py <user_id>` — синхронизация руками (то же, что POST /sync).
- `Dockerfile` — python:3.12-slim + uvicorn.
- `data/` — токены (per-user подпапки) и файлы, в git не попадает. Токены
  дают доступ к аккаунту Garmin — обращаться как с паролем.
- `docs/structured-workouts.md` — заметки: создание структурированных тренировок
  через garminconnect (модели, календарь, lap-кнопка) — реализовано, см.
  `app/workout_builder.py` и `POST /users/{id}/workouts` выше.
