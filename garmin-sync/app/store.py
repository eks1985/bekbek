"""SQLite-хранилище: что уже скачано и когда была последняя синхронизация.
Один файл на volume (GARMIN_DB_PATH), без сервера БД. Несколько пользователей
живут в одной базе — везде составной ключ (user_id, ...), таблицы на человека
не плодим (3-5 пользователей, WAL хватает с запасом)."""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.config import DB_PATH, MAX_ATTEMPTS

SCHEMA = """
CREATE TABLE IF NOT EXISTS activities (
    user_id       TEXT NOT NULL,
    activity_id   TEXT NOT NULL,     -- id активности Garmin
    start_time    TEXT,              -- UTC, "2026-10-31 07:12:33"
    activity_type TEXT,              -- typeKey: running, track_running, ...
    name          TEXT,
    fit_path      TEXT,              -- путь к .fit на диске (или NULL при ошибке)
    sha256        TEXT,
    size_bytes    INTEGER,
    status        TEXT NOT NULL,     -- downloaded | failed
    error         TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    discovered_at TEXT NOT NULL,
    downloaded_at TEXT,
    PRIMARY KEY (user_id, activity_id)
);
CREATE TABLE IF NOT EXISTS meta (
    user_id TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT,
    PRIMARY KEY (user_id, key)
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def upsert_activity(user_id: str, a: dict) -> None:
    """Вставить/обновить активность. a — колонки таблицы activities,
    кроме user_id/discovered_at (проставляются здесь)."""
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO activities (user_id, activity_id, start_time, activity_type, name,
                                    fit_path, sha256, size_bytes, status, error,
                                    attempts, discovered_at, downloaded_at)
            VALUES (:user_id, :activity_id, :start_time, :activity_type, :name,
                    :fit_path, :sha256, :size_bytes, :status, :error,
                    :attempts, :discovered_at, :downloaded_at)
            ON CONFLICT(user_id, activity_id) DO UPDATE SET
                start_time=excluded.start_time, activity_type=excluded.activity_type,
                name=excluded.name, fit_path=excluded.fit_path, sha256=excluded.sha256,
                size_bytes=excluded.size_bytes, status=excluded.status,
                error=excluded.error, attempts=excluded.attempts,
                downloaded_at=excluded.downloaded_at
            """,
            {"user_id": user_id, "discovered_at": _now(), "attempts": 0, "error": None, **a},
        )


def mark_failed(user_id: str, activity_id: int, error: str, info: dict | None = None) -> None:
    """Запомнить ошибку скачивания. info — что известно из списка Garmin
    (start_time/activity_type/name), чтобы failed-строки не выпадали из
    сортировки и фильтра since у GET /activities."""
    info = info or {}
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO activities (user_id, activity_id, start_time, activity_type, name,
                                    status, error, attempts, discovered_at)
            VALUES (?, ?, ?, ?, ?, 'failed', ?, 1, ?)
            ON CONFLICT(user_id, activity_id) DO UPDATE SET
                start_time=COALESCE(excluded.start_time, start_time),
                activity_type=COALESCE(excluded.activity_type, activity_type),
                name=COALESCE(excluded.name, name),
                status='failed', error=excluded.error, attempts=attempts + 1
            """,
            (user_id, str(activity_id), info.get("start_time"), info.get("activity_type"),
             info.get("name"), error[:500], _now()),
        )


def get(user_id: str, activity_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM activities WHERE user_id = ? AND activity_id = ?",
            (user_id, str(activity_id)),
        ).fetchone()


def pending_ids(user_id: str) -> set[str]:
    """Id, которые не нужно качать: скачанные (и файл на месте) и failed,
    у которых кончились попытки."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT activity_id, status, attempts, fit_path FROM activities WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    settled: set[str] = set()
    for r in rows:
        if r["status"] == "downloaded" and r["fit_path"] and Path(r["fit_path"]).exists():
            settled.add(r["activity_id"])
        elif r["status"] == "failed" and r["attempts"] >= MAX_ATTEMPTS:
            settled.add(r["activity_id"])
    return settled


def list_activities(user_id: str, since: str | None = None) -> list[dict]:
    """Активности для GET /activities, новые сверху. since — ISO-дата/время,
    фильтрует по start_time (грубое сравнение строк: "2026-10-31 ..." > "2026-10-30")."""
    with connect() as conn:
        if since:
            rows = conn.execute(
                "SELECT * FROM activities WHERE user_id = ? AND start_time >= ? "
                "ORDER BY start_time DESC",
                (user_id, since),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM activities WHERE user_id = ? ORDER BY start_time DESC",
                (user_id,),
            ).fetchall()
    return [dict(r) for r in rows]


def get_meta(user_id: str, key: str) -> str | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT value FROM meta WHERE user_id = ? AND key = ?", (user_id, key)
        ).fetchone()
    return row["value"] if row else None


def set_meta(user_id: str, key: str, value: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO meta (user_id, key, value) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value",
            (user_id, key, value),
        )


def list_users_with_meta(key: str, value: str) -> list[str]:
    """user_id всех, у кого meta[key] == value — например, кто сейчас включил
    фоновую подгрузку истории (key="history_sync_active")."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT DISTINCT user_id FROM meta WHERE key = ? AND value = ?", (key, value)
        ).fetchall()
    return [r["user_id"] for r in rows]
