"""Настройки из переменных окружения. Пути по умолчанию — для локального запуска
из папки garmin-sync/, на сервере их переопределяют на volume (/data/...)."""

import os
from pathlib import Path

TOKEN_DIR = Path(os.getenv("GARMIN_TOKEN_DIR", "./data/tokens"))
FIT_DIR = Path(os.getenv("GARMIN_FIT_DIR", "./data/fit"))
DB_PATH = Path(os.getenv("GARMIN_DB_PATH", "./data/garmin.db"))

# Общий секрет с bek-bek; пустой = все эндпоинты, кроме /health, всегда 403
SYNC_TOKEN = os.getenv("GARMIN_SYNC_TOKEN", "")

# Сколько последних активностей запрашивать у Garmin за один синк
LIST_LIMIT = int(os.getenv("GARMIN_LIST_LIMIT", "20"))
# Не чаще раза в столько секунд ходить в Garmin (между вызовами POST /sync)
SYNC_MIN_INTERVAL_SEC = int(os.getenv("GARMIN_SYNC_MIN_INTERVAL_SEC", "60"))
# Попыток скачать неудавшуюся активность, прежде чем оставить её в покое
MAX_ATTEMPTS = int(os.getenv("GARMIN_MAX_ATTEMPTS", "3"))
# Активности раньше этой даты не качаем ("2026-10-01"; пусто = качать всё)
IMPORT_FROM = os.getenv("GARMIN_IMPORT_FROM", "")

# Куда редиректить со страницы /auth после успешного входа (обычно dashboard
# bek-bek); пусто — страница просто показывает «Готово» без перехода.
AUTH_RETURN_URL = os.getenv("AUTH_RETURN_URL", "")
