# garmin-sync — загрузка тренировок из Garmin Connect

Маленький Python-сервис на VPS (Dokploy). Забирает оригинальные FIT-файлы
из Garmin Connect, а bek-bek потом забирает их у него по HTTPS. В S3 сервис
не пишет: немецкий VPS не дотягивается до российского Selectel, поэтому
файл в бакет кладёт сам bek-bek, как при ручной загрузке.

Библиотека — [`garminconnect`](https://github.com/cyberjunky/python-garminconnect)
0.3.x (без garth; токены в `garmin_tokens.json`, обновляются сами).

Готовы шаги 1–4 (см. PLAN.md): прототип на VPS, SQLite-синхронизация, HTTP API
и деплой в Dokploy — https://garmin.terravitafze.com. Дальше: связка с bek-bek
(шаги 5–8).

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
python -m scripts.login                # email, пароль, код MFA → /data/tokens/garmin_tokens.json
python -m scripts.try_download         # 10 последних активностей + FIT последней
python -m scripts.try_download 24300728659   # или конкретная по id
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
```

Первый вход Garmin нужен, только если токенов ещё нет на volume (после шага 1
они уже есть):

```bash
docker exec -it <контейнер> python -m scripts.login
```

Проверка после деплоя: `curl https://garmin.terravitafze.com/health` →
`garmin_logged_in:true`; `POST /sync` с токеном качает новое; редеплой не
теряет токены и SQLite.

## Что где лежит

- `app/config.py` — настройки из env (пути, секрет, троттлинг, IMPORT_FROM).
- `app/garmin_client.py` — вход по токенам, список активностей, скачивание
  ORIGINAL (zip → `.fit`, проверка заголовка `.FIT`).
- `app/store.py` — SQLite: таблицы `activities` и `meta` (last_sync_at).
- `app/sync.py` — `sync_once()`: список → новое → скачать; ошибка одной
  активности не валит остальные (status=failed, attempts+1).
- `app/main.py` — FastAPI: /health, /sync, /activities, /activities/{id}/fit;
  bearer-секрет, троттлинг, lock.
- `scripts/check_network.py` — DNS и HTTPS до хостов Garmin, без логина и зависимостей.
- `scripts/login.py` — однократный вход по паролю, пароль не сохраняется; без DI-токена честно падает.
- `scripts/try_download.py` — ручная проверка шага 1.
- `scripts/sync_cli.py` — синхронизация руками (то же, что POST /sync).
- `Dockerfile` — python:3.12-slim + uvicorn.
- `data/` — токены и файлы, в git не попадает. Токены дают доступ к аккаунту
  Garmin — обращаться как с паролем.
