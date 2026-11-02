# garmin-sync — загрузка тренировок из Garmin Connect

Маленький Python-сервис на VPS (Dokploy). Забирает оригинальные FIT-файлы
из Garmin Connect, а bek-bek потом забирает их у него по HTTPS. В S3 сервис
не пишет: немецкий VPS не дотягивается до российского Selectel, поэтому
файл в бакет кладёт сам bek-bek, как при ручной загрузке.

Библиотека — [`garminconnect`](https://github.com/cyberjunky/python-garminconnect)
0.3.x (без garth; токены в `garmin_tokens.json`, обновляются сами).

Сейчас готов **шаг 1** — прототип в консоли: проверка сети, вход и пробное
скачивание. Дальше по плану: SQLite и дедупликация → HTTP API → Docker/Dokploy →
импорт в bek-bek.

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

## Что где лежит

- `app/config.py` — пути из env (`GARMIN_TOKEN_DIR`, `GARMIN_FIT_DIR`).
- `app/garmin_client.py` — вход по токенам, список активностей, скачивание
  ORIGINAL (zip → `.fit`, проверка заголовка `.FIT`).
- `scripts/check_network.py` — DNS и HTTPS до хостов Garmin, без логина и зависимостей.
- `scripts/login.py` — однократный вход по паролю, пароль не сохраняется; без DI-токена честно падает.
- `scripts/try_download.py` — ручная проверка шага 1.
- `data/` — токены и файлы, в git не попадает. Токены дают доступ к аккаунту
  Garmin — обращаться как с паролем.
