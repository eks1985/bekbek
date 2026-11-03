"""Синхронизация с Garmin: обычная (последние активности, автоматическая) и
историческая (подгрузка старых порциями, по клику «+10 тренировок» в bek-bek).
Ошибка одной активности не валит остальные. Повторный запуск без новых
тренировок = 0 скачиваний."""

from datetime import datetime, timezone
from pathlib import Path

from garminconnect import Garmin

from app import garmin_client, store
from app.config import IMPORT_FROM, LIST_LIMIT, MAX_ATTEMPTS, fit_dir_for, token_dir_for


def _after_import_from(start_time_gmt: str | None) -> bool:
    """Активность новее GARMIN_IMPORT_FROM (сравниваем дату начала, UTC)."""
    if not IMPORT_FROM:
        return True
    if not start_time_gmt:  # даты нет — качаем, пусть лучше будет
        return True
    return (start_time_gmt or "")[:10] >= IMPORT_FROM


def _download_one(
    user_id: str, fit_dir: Path, api: Garmin, a: garmin_client.ActivityInfo
) -> tuple[bool, str | None]:
    """Скачивает одну активность и пишет результат в store. Первый элемент —
    успех; второй — текст ошибки (или None при успехе)."""
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
        return True, None
    except Exception as e:  # сеть/формат конкретного файла — идём дальше
        store.mark_failed(
            user_id, a.activity_id, str(e),
            {"start_time": a.start_time_gmt, "activity_type": a.activity_type, "name": a.name},
        )
        return False, str(e)


def sync_once(user_id: str) -> dict:
    """Обычный синк: последние LIST_LIMIT активностей, с учётом GARMIN_IMPORT_FROM.
    Вызывается автоматически при открытии dashboard bek-bek."""
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
        ok, error = _download_one(user_id, fit_dir, api, a)
        if ok:
            downloaded.append(str(a.activity_id))
        else:
            failed.append({"activity_id": str(a.activity_id), "error": error})

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


def sync_history(user_id: str, count: int = 10) -> dict:
    """Подгружает следующую порцию более старых активностей — по явному клику
    «+10 тренировок», GARMIN_IMPORT_FROM не учитывает (это и есть цель кнопки).
    Смещение от самой свежей активности храним в meta (history_offset), по
    умолчанию начинаем сразу за окном обычного синка (LIST_LIMIT), чтобы
    первый клик не повторял то, что уже подтянул sync_once."""
    api = garmin_client.connect(token_dir_for(user_id))
    fit_dir = fit_dir_for(user_id)

    offset_str = store.get_meta(user_id, "history_offset")
    offset = int(offset_str) if offset_str else LIST_LIMIT

    batch = garmin_client.list_range(api, offset, count)
    settled = store.pending_ids(user_id)

    downloaded: list[str] = []
    failed: list[dict] = []
    skipped = 0
    for a in batch:
        if str(a.activity_id) in settled:
            skipped += 1
            continue
        ok, error = _download_one(user_id, fit_dir, api, a)
        if ok:
            downloaded.append(str(a.activity_id))
        else:
            failed.append({"activity_id": str(a.activity_id), "error": error})

    new_offset = offset + len(batch)
    store.set_meta(user_id, "history_offset", str(new_offset))
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "seen": len(batch),
        "downloaded": downloaded,
        "failed": failed,
        "skipped": skipped,
        "max_attempts": MAX_ATTEMPTS,
        "offset": new_offset,
        "has_more": len(batch) == count,  # Garmin отдал меньше запрошенного — история кончилась
    }
