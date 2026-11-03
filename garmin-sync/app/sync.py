"""Одна синхронизация: спросить у Garmin последние активности, скачать те,
которых нет (или failed с оставшимися попытками). Ошибка одной активности
не валит остальные. Повторный запуск без новых тренировок = 0 скачиваний."""

from datetime import datetime, timezone

from app import garmin_client, store
from app.config import IMPORT_FROM, LIST_LIMIT, MAX_ATTEMPTS, fit_dir_for, token_dir_for


def _after_import_from(start_time_gmt: str | None) -> bool:
    """Активность новее GARMIN_IMPORT_FROM (сравниваем дату начала, UTC)."""
    if not IMPORT_FROM:
        return True
    if not start_time_gmt:  # даты нет — качаем, пусть лучше будет
        return True
    return (start_time_gmt or "")[:10] >= IMPORT_FROM


def sync_once(user_id: str) -> dict:
    api = garmin_client.connect(token_dir_for(user_id))  # NotLoggedInError — честный ответ /health
    fit_dir = fit_dir_for(user_id)
    recent = garmin_client.list_recent(api, limit=LIST_LIMIT)
    settled = store.pending_ids(user_id)

    downloaded: list[str] = []
    failed: list[dict] = []
    skipped = 0
    for a in recent:
        if not _after_import_from(a.start_time_gmt) or str(a.activity_id) in settled:
            skipped += 1
            continue
        try:
            data = garmin_client.download_fit(api, a.activity_id)
            fit_dir.mkdir(parents=True, exist_ok=True)
            path = fit_dir / f"{a.activity_id}.fit"
            path.write_bytes(data)
            store.upsert_activity(
                user_id,
                {
                    "activity_id": str(a.activity_id),
                    "start_time": a.start_time_gmt,
                    "activity_type": a.activity_type,
                    "name": a.name,
                    "fit_path": str(path),
                    "sha256": garmin_client.sha256_hex(data),
                    "size_bytes": len(data),
                    "status": "downloaded",
                    "downloaded_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            downloaded.append(str(a.activity_id))
        except Exception as e:  # сеть/формат конкретного файла — идём дальше
            store.mark_failed(
                user_id, a.activity_id, str(e),
                {"start_time": a.start_time_gmt, "activity_type": a.activity_type, "name": a.name},
            )
            failed.append({"activity_id": str(a.activity_id), "error": str(e)})

    checked_at = datetime.now(timezone.utc).isoformat()
    store.set_meta(user_id, "last_sync_at", checked_at)
    return {
        "checked_at": checked_at,
        "seen": len(recent),
        "downloaded": downloaded,
        "failed": failed,
        "skipped": skipped,
        "max_attempts": MAX_ATTEMPTS,
    }
