"""Тонкий слой над garminconnect: вход по сохранённым токенам, список
активностей, скачивание оригинального FIT."""

import hashlib
import io
import zipfile
from dataclasses import dataclass

from garminconnect import Garmin

from app.config import TOKEN_DIR


class NotLoggedInError(RuntimeError):
    """Токенов нет или Garmin их не принял — нужен python -m scripts.login."""


def connect() -> Garmin:
    """Клиент Garmin по токенам из TOKEN_DIR, без логина и пароля.

    Библиотека сама обновляет истекающий токен и записывает новый обратно
    в TOKEN_DIR/garmin_tokens.json, поэтому вход вручную нужен раз в долгое время.
    """
    if not (TOKEN_DIR / "garmin_tokens.json").exists():
        raise NotLoggedInError(
            f"Нет токенов в {TOKEN_DIR}. Сначала войдите: python -m scripts.login"
        )
    api = Garmin()
    try:
        api.login(str(TOKEN_DIR))
    except Exception as e:  # библиотека бросает разные типы — для нас это одно
        raise NotLoggedInError(
            f"Garmin не принял сохранённые токены ({e}). Войдите заново: python -m scripts.login"
        ) from e
    return api


@dataclass
class ActivityInfo:
    activity_id: int
    start_time_gmt: str | None  # "2026-10-31 07:12:33", UTC
    start_time_local: str | None
    activity_type: str | None  # typeKey: running, track_running, ...
    name: str | None
    distance_m: float | None
    duration_sec: float | None


def to_activity_info(raw: dict) -> ActivityInfo:
    return ActivityInfo(
        activity_id=int(raw["activityId"]),
        start_time_gmt=raw.get("startTimeGMT"),
        start_time_local=raw.get("startTimeLocal"),
        activity_type=(raw.get("activityType") or {}).get("typeKey"),
        name=raw.get("activityName"),
        distance_m=raw.get("distance"),
        duration_sec=raw.get("duration"),
    )


def list_recent(api: Garmin, limit: int = 20) -> list[ActivityInfo]:
    """Последние активности, новые сверху."""
    raw = api.get_activities(0, limit)
    return [to_activity_info(a) for a in raw if isinstance(a, dict) and "activityId" in a]


def is_fit(data: bytes) -> bool:
    """Заголовок FIT: байты 8–11 — ASCII ".FIT" (как isFitFile в bek-bek)."""
    return len(data) >= 12 and data[8:12] == b".FIT"


def extract_fit(zip_bytes: bytes) -> bytes:
    """Garmin отдаёт «оригинал» zip-архивом с одним .fit внутри."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".fit")]
        if len(names) != 1:
            raise ValueError(f"В архиве ожидался один .fit, а там: {zf.namelist()}")
        data = zf.read(names[0])
    if not is_fit(data):
        raise ValueError(f"{names[0]} — не FIT-файл (нет заголовка .FIT)")
    return data


def download_fit(api: Garmin, activity_id: int) -> bytes:
    """Оригинальный FIT активности (байты .fit, уже из zip)."""
    zip_bytes = api.download_activity(
        str(activity_id), dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL
    )
    return extract_fit(zip_bytes)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
