# garmin-sync — загрузка тренировок из Garmin Connect

Маленький Python-сервис на VPS (Dokploy). Забирает оригинальные FIT-файлы
из Garmin Connect, а bek-bek потом забирает их у него по HTTPS. В S3 сервис
не пишет: немецкий VPS не дотягивается до российского Selectel, поэтому
файл в бакет кладёт сам bek-bek, как при ручной загрузке.

Библиотека — [`garminconnect`](https://github.com/cyberjunky/python-garminconnect)
0.3.x (без garth; токены в `garmin_tokens.json`, обновляются сами).

Сейчас готов **шаг 1** — прототип в консоли: вход и пробное скачивание.
Дальше по плану: SQLite и дедупликация → HTTP API → Docker/Dokploy → импорт в bek-bek.

## Локальный запуск (шаг 1)

Python 3.12+. Команды — из папки `garmin-sync/`:

```powershell
cd C:\Documents\apps\bek-bek\garmin-sync
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 1. Вход: email, пароль, код MFA (если включён). Токены — в data\tokens\
python -m scripts.login

# 2. Последние 10 активностей + скачать оригинальный FIT последней
python -m scripts.try_download
# или конкретную активность по id (id — в списке или в адресе на connect.garmin.com)
python -m scripts.try_download 24300728659
```

Файл ляжет в `data\fit\<activityId>.fit`. Проверка, что bek-bek его понимает
(из корня репо):

```powershell
cd ..
npx tsx scripts/parse-fit.ts garmin-sync/data/fit/<activityId>.fit --workout auto
```

Итоги в JSON (дистанция, время, круги) должны совпасть с тем, что видно в Garmin Connect.

## Что где лежит

- `app/config.py` — пути из env (`GARMIN_TOKEN_DIR`, `GARMIN_FIT_DIR`).
- `app/garmin_client.py` — вход по токенам, список активностей, скачивание
  ORIGINAL (zip → `.fit`, проверка заголовка `.FIT`).
- `scripts/login.py` — однократный вход по паролю, пароль не сохраняется.
- `scripts/try_download.py` — ручная проверка шага 1.
- `data/` — токены и файлы, в git не попадает. Токены дают доступ к аккаунту
  Garmin — обращаться как с паролем.
