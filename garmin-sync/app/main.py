"""HTTP-обёртка (шаг 3): FastAPI поверх sync/store.

    GET  /health                  без авторизации: живость + last_sync_at + есть ли токены
    POST /sync                    спросить Garmin и скачать новое (троттлинг, lock)
    GET  /activities?since=ISO    список из SQLite
    GET  /activities/{id}/fit     байты .fit
    GET  /auth                    страница обновления токена (пароль Garmin, без авторизации)
    POST /auth/start              шаг 1 входа: email+пароль
    POST /auth/finish             шаг 2: код MFA, если понадобился

Всё, кроме /health и /auth (GET, сама форма), — под общим секретом:
Authorization: Bearer <GARMIN_SYNC_TOKEN>. Синхронный garminconnect уходит
в threadpool, чтобы не блокировать event loop (FastAPI сам запускает обычные
def-хендлеры в threadpool, poэтому /auth/* — не async).
"""

import asyncio
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app import garmin_client, store, sync
from app.config import SYNC_MIN_INTERVAL_SEC, SYNC_TOKEN, TOKEN_DIR

_sync_lock = asyncio.Lock()

# Незавершённые входы (ждут код MFA): attempt_id -> (поставлено, client_state).
# В памяти процесса — переживать редеплой не нужно, вход всё равно начинают заново.
_PENDING_LOGINS: dict[str, tuple[float, Any]] = {}
_LOGIN_ATTEMPT_TTL_SEC = 300


def _cleanup_pending_logins() -> None:
    now = time.time()
    expired = [k for k, (ts, _) in _PENDING_LOGINS.items() if now - ts > _LOGIN_ATTEMPT_TTL_SEC]
    for k in expired:
        _PENDING_LOGINS.pop(k, None)


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


class AuthStartBody(BaseModel):
    email: str
    password: str


class AuthFinishBody(BaseModel):
    attempt_id: str
    code: str


@app.post("/auth/start", dependencies=[Depends(require_token)])
def auth_start(body: AuthStartBody) -> dict:
    """Шаг 1 входа (см. PLAN.md, брейншторм про обновление токена — вариант А)."""
    _cleanup_pending_logins()
    try:
        needs_mfa, client_state = garmin_client.start_login(body.email, body.password)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not needs_mfa:
        return {"needs_mfa": False}
    attempt_id = secrets.token_urlsafe(16)
    _PENDING_LOGINS[attempt_id] = (time.time(), client_state)
    return {"needs_mfa": True, "attempt_id": attempt_id}


@app.post("/auth/finish", dependencies=[Depends(require_token)])
def auth_finish(body: AuthFinishBody) -> dict:
    """Шаг 2: код MFA довершает вход, начатый /auth/start."""
    _cleanup_pending_logins()
    entry = _PENDING_LOGINS.pop(body.attempt_id, None)
    if not entry:
        raise HTTPException(
            status_code=400, detail="Попытка входа не найдена или истекла — начните заново"
        )
    _, client_state = entry
    try:
        garmin_client.finish_login(client_state, body.code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}


_AUTH_PAGE = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>garmin-sync — обновить вход</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 420px; margin: 40px auto; padding: 0 16px; }
  label { display: block; margin-top: 12px; font-size: 14px; color: #333; }
  input { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; }
  button { margin-top: 16px; padding: 8px 16px; cursor: pointer; }
  #msg { margin-top: 16px; white-space: pre-wrap; }
  .err { color: #b00020; }
  .ok { color: #0a7a2f; }
  #mfa-block { display: none; }
</style>
</head>
<body>
<h3>garmin-sync — обновить вход в Garmin</h3>
<p>Токен сервиса (GARMIN_SYNC_TOKEN), email и пароль Garmin никуда кроме этого
сервиса не уходят — страница шлёт их напрямую на этот же домен.</p>

<div id="start-block">
  <label>Токен сервиса <input id="token" type="password" autocomplete="off"></label>
  <label>Email Garmin <input id="email" type="email" autocomplete="off"></label>
  <label>Пароль Garmin <input id="password" type="password" autocomplete="off"></label>
  <button id="start-btn">Войти</button>
</div>

<div id="mfa-block">
  <label>Код MFA (из письма/приложения) <input id="code" type="text" autocomplete="off"></label>
  <button id="finish-btn">Подтвердить</button>
</div>

<div id="msg"></div>

<script>
let attemptId = null;

function msg(text, cls) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = cls || '';
}

document.getElementById('start-btn').onclick = async () => {
  const token = document.getElementById('token').value;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  msg('Входим…');
  try {
    const res = await fetch('/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) { msg(data.detail || 'Ошибка входа', 'err'); return; }
    if (data.needs_mfa) {
      attemptId = data.attempt_id;
      document.getElementById('mfa-block').style.display = 'block';
      msg('Введите код MFA — он уже должен прийти.', 'ok');
    } else {
      msg('Готово — вход выполнен, токены сохранены.', 'ok');
    }
  } catch (e) {
    msg('Сеть недоступна: ' + e, 'err');
  }
};

document.getElementById('finish-btn').onclick = async () => {
  const token = document.getElementById('token').value;
  const code = document.getElementById('code').value;
  msg('Подтверждаем код…');
  try {
    const res = await fetch('/auth/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ attempt_id: attemptId, code }),
    });
    const data = await res.json();
    if (!res.ok) { msg(data.detail || 'Ошибка подтверждения', 'err'); return; }
    msg('Готово — вход выполнен, токены сохранены.', 'ok');
  } catch (e) {
    msg('Сеть недоступна: ' + e, 'err');
  }
};
</script>
</body>
</html>"""


@app.get("/auth", response_class=HTMLResponse)
def auth_page() -> str:
    """Форма обновления токена Garmin. Сама страница не секрет — ничего не
    отправляет и не показывает без ввода GARMIN_SYNC_TOKEN в поле."""
    return _AUTH_PAGE
