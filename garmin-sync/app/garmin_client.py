"""Тонкий слой над garminconnect: вход по сохранённым токенам, список
активностей, скачивание оригинального FIT. Везде по явному token_dir —
у каждого пользователя свой (см. config.token_dir_for)."""

import hashlib
import io
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from garminconnect import Garmin


class NotLoggedInError(RuntimeError):
    """Токенов нет или Garmin их не принял — нужен новый вход (python -m scripts.login
    или POST /users/{user_id}/auth/start на этом же сервисе)."""


def connect(token_dir: Path) -> Garmin:
    """Клиент Garmin по токенам из token_dir, без логина и пароля.

    Библиотека сама обновляет истекающий токен и записывает новый обратно
    в token_dir/garmin_tokens.json, поэтому вход вручную нужен раз в долгое время.
    """
    if not (token_dir / "garmin_tokens.json").exists():
        raise NotLoggedInError(
            f"Нет токенов в {token_dir}. Сначала войдите: /auth этого пользователя"
        )
    api = Garmin()
    try:
        api.login(str(token_dir))
    except Exception as e:  # библиотека бросает разные типы — для нас это одно
        raise NotLoggedInError(
            f"Garmin не принял сохранённые токены ({e}). Войдите заново через /auth."
        ) from e
    return api


def _dump_and_verify(api: Garmin, token_dir: Path) -> None:
    """Сохраняет токены в token_dir и проверяет, что DI-токен реально записался
    (та же проверка, что в scripts.login — иначе Garmin мог «войти» через
    cookie веб-портала, а на диск сохранять нечего)."""
    token_dir.mkdir(parents=True, exist_ok=True)
    api.client.dump(str(token_dir))
    token_file = token_dir / "garmin_tokens.json"
    if not (api.client.di_token and api.client.di_refresh_token and token_file.exists()):
        token_file.unlink(missing_ok=True)
        raise RuntimeError(
            "Пароль принят, но DI-токен не получен — сохранять нечего. "
            "Скорее всего, недоступен diauth.garmin.com — проверьте python -m scripts.check_network"
        )


def start_login(email: str, password: str, token_dir: Path) -> tuple[bool, Any]:
    """Начинает вход по email/паролю без интерактивного prompt_mfa — для шага 1
    HTTP-формы на /auth. Если MFA не нужен — токены уже сохранены, возвращает
    (False, None). Если нужен — возвращает (True, client_state); client_state
    хранит сессионные cookie, обращаться с ним как с паролем."""
    api = Garmin(email=email, password=password, return_on_mfa=True)
    mfa_status, client_state = api.login()
    if mfa_status == "needs_mfa":
        return True, client_state
    _dump_and_verify(api, token_dir)
    return False, None


def finish_login(client_state: Any, mfa_code: str, token_dir: Path) -> None:
    """Шаг 2: код MFA довершает вход, начатый start_login. Новый инстанс
    Garmin — library это поддерживает явно (resume_login документирован как
    работающий с другим объектом/процессом)."""
    api = Garmin(return_on_mfa=True)
    api.resume_login(client_state, mfa_code)
    _dump_and_verify(api, token_dir)


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
