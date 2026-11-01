"""Настройки из переменных окружения. Пути по умолчанию — для локального запуска
из папки garmin-sync/, на сервере их переопределяют на volume (/data/...)."""

import os
from pathlib import Path

TOKEN_DIR = Path(os.getenv("GARMIN_TOKEN_DIR", "./data/tokens"))
FIT_DIR = Path(os.getenv("GARMIN_FIT_DIR", "./data/fit"))
