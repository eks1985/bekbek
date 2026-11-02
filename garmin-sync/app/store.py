"""SQLite-хранилище: что уже скачано и когда была последняя синхронизация.
Один файл на volume (GARMIN_DB_PATH), без сервера БД."""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.config import DB_PATH, MAX_ATTEMPTS

SCHEMA = """
CREATE TABLE IF NOT EXISTS activities (
    activity_id   TEXT PRIMARY KEY,   -- id активности Garmin
    start_time    TEXT,               -- UTC, "2026-10-31 07:12:33"
    activity_type TEXT,               -- typeKey: running, track_running, ...
    name          TEXT,
    fit_path      TEXT,               -- путь к .fit на диске (или NULL при ошибке)
    sha256        TEXT,
    size_bytes    INTEGER,
    status        TEXT NOT NULL,      -- downloaded | failed
    error         TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    discovered_at TEXT NOT NULL,
    downloaded_at TEXT
);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def upsert_activity(a: dict) -> None:
    """Вставить/обновить активность. a — колонки таблицы activities,
    кроме discovered_at (проставляется здесь при вставке)."""
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO activities (activity_id, start_time, activity_type, name,
                                    fit_path, sha256, size_bytes, status, error,
                                    attempts, discovered_at, downloaded_at)
            VALUES (:activity_id, :start_time, :activity_type, :name,
                    :fit_path, :sha256, :size_bytes, :status, :error,
                    :attempts, :discovered_at, :downloaded_at)
            ON CONFLICT(activity_id) DO UPDATE SET
                start_time=excluded.start_time, activity_type=excluded.activity_type,
                name=excluded.name, fit_path=excluded.fit_path, sha256=excluded.sha256,
                size_bytes=excluded.size_bytes, status=excluded.status,
                error=excluded.error, attempts=excluded.attempts,
                downloaded_at=excluded.downloaded_at
            """,
            {"discovered_at": _now(), "attempts": 0, "error": None, **a},
        )


def mark_failed(activity_id: int, error: str, info: dict | None = None) -> None:
    """Запомнить ошибку скачивания. info — что известно из списка Garmin
    (start_time/activity_type/name), чтобы failed-строки не выпадали из
    сортировки и фильтра since у GET /activities."""
    info = info or {}
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO activities (activity_id, start_time, activity_type, name,
                                    status, error, attempts, discovered_at)
            VALUES (?, ?, ?, ?, 'failed', ?, 1, ?)
            ON CONFLICT(activity_id) DO UPDATE SET
                start_time=COALESCE(excluded.start_time, start_time),
                activity_type=COALESCE(excluded.activity_type, activity_type),
                name=COALESCE(excluded.name, name),
                status='failed', error=excluded.error, attempts=attempts + 1
            """,
            (str(activity_id), info.get("start_time"), info.get("activity_type"),
             info.get("name"), error[:500], _now()),
        )


def get(activity_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM activities WHERE activity_id = ?", (str(activity_id),)
        ).fetchone()


def pending_ids() -> set[str]:
    """Id, которые не нужно качать: скачанные (и файл на месте) и failed,
    у которых кончились попытки."""
    with connect() as conn:
        rows = conn.execute("SELECT activity_id, status, attempts, fit_path FROM activities").fetchall()
    settled: set[str] = set()
    for r in rows:
        if r["status"] == "downloaded" and r["fit_path"] and Path(r["fit_path"]).exists():
            settled.add(r["activity_id"])
        elif r["status"] == "failed" and r["attempts"] >= MAX_ATTEMPTS:
            settled.add(r["activity_id"])
    return settled


def list_activities(since: str | None = None) -> list[dict]:
    """Активности для GET /activities, новые сверху. since — ISO-дата/время,
    фильтрует по start_time (грубое сравнение строк: "2026-10-31 ..." > "2026-10-30")."""
    with connect() as conn:
        if since:
            rows = conn.execute(
                "SELECT * FROM activities WHERE start_time >= ? ORDER BY start_time DESC",
                (since,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM activities ORDER BY start_time DESC").fetchall()
    return [dict(r) for r in rows]


def get_meta(key: str) -> str | None:
    with connect() as conn:
        row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(key: str, value: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
