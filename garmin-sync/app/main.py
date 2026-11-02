"""HTTP-обёртка (шаг 3): FastAPI поверх sync/store.

    GET  /health                  без авторизации: живость + last_sync_at + есть ли токены
    POST /sync                    спросить Garmin и скачать новое (троттлинг, lock)
    GET  /activities?since=ISO    список из SQLite
    GET  /activities/{id}/fit     байты .fit

Всё, кроме /health, — под общим секретом: Authorization: Bearer <GARMIN_SYNC_TOKEN>.
Синхронный garminconnect уходит в threadpool, чтобы не блокировать event loop.
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from app import garmin_client, store, sync
from app.config import SYNC_MIN_INTERVAL_SEC, SYNC_TOKEN, TOKEN_DIR

_sync_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.init()
    yield


app = FastAPI(title="garmin-sync", lifespan=lifespan)


def require_token(request: Request) -> None:
    """401 без/с неверным секретом. Если секрет не задан совсем — тоже 401:
    сервис без GARMIN_SYNC_TOKEN наружу ничего не отдаёт."""
    auth = request.headers.get("authorization", "")
    if not SYNC_TOKEN or auth != f"Bearer {SYNC_TOKEN}":
        raise HTTPException(status_code=401, detail="нужен Authorization: Bearer <GARMIN_SYNC_TOKEN>")


def _seconds_since(iso: str) -> float:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds()


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "last_sync_at": store.get_meta("last_sync_at"),
        "garmin_logged_in": (TOKEN_DIR / "garmin_tokens.json").exists(),
    }


@app.post("/sync")
async def do_sync(_: None = Depends(require_token)) -> dict:
    last = store.get_meta("last_sync_at")
    if last and _seconds_since(last) < SYNC_MIN_INTERVAL_SEC:
        return {"checked_at": last, "downloaded": [], "failed": [], "throttled": True}
    if _sync_lock.locked():  # второй параллельный вызов не ждёт и не ходит в Garmin
        return {"checked_at": last, "downloaded": [], "failed": [], "throttled": True, "busy": True}
    async with _sync_lock:
        try:
            result = await run_in_threadpool(sync.sync_once)
        except garmin_client.NotLoggedInError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
    return {**result, "throttled": False}


@app.get("/activities")
def activities(since: str | None = None, _: None = Depends(require_token)) -> list[dict]:
    fields = ("activity_id", "start_time", "activity_type", "name", "sha256", "size_bytes", "status")
    return [{k: row[k] for k in fields} for row in store.list_activities(since)]


@app.get("/activities/{activity_id}/fit")
def activity_fit(activity_id: str, _: None = Depends(require_token)) -> Response:
    row = store.get(activity_id)
    if not row or row["status"] != "downloaded" or not row["fit_path"]:
        raise HTTPException(status_code=404, detail=f"активность {activity_id} не скачана")
    path = Path(row["fit_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"файл пропал с диска: {path}")
    return Response(
        content=path.read_bytes(),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{activity_id}.fit"'},
    )
