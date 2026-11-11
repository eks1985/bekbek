"""HTTP-обёртка поверх sync/store/garmin_client. Несколько пользователей —
каждый в своём namespace по user_id (bek-bek передаёт его, обычно это
userId из своей БД); данные на диске и в SQLite разделены per-user.

    GET  /health                            без авторизации: процесс жив
    GET  /users/{user_id}/health             без авторизации: last_sync_at + есть ли токены у этого user_id
    POST /users/{user_id}/sync               спросить Garmin и скачать новое (троттлинг, lock — per-user)
    GET  /users/{user_id}/activities?since=ISO
    GET  /users/{user_id}/activities/{id}/fit
    POST /users/{user_id}/workouts            создать структурированную тренировку в Garmin Connect
    GET  /users/{user_id}/auth                страница обновления токена (без авторизации)
    POST /users/{user_id}/auth/start          шаг 1 входа: email+пароль
    POST /users/{user_id}/auth/finish         шаг 2: код MFA, если понадобился

Всё, кроме /health и /users/{user_id}/auth (GET, сама форма), — под общим
секретом: Authorization: Bearer <GARMIN_SYNC_TOKEN>. Это доверие к bek-bek как
к серверу (он сам знает, какой у него сейчас пользователь, и передаёт его
user_id в пути) — отдельного секрета на каждого человека не заводим, это были
бы 3-5 токенов ради 3-5 пользователей без дополнительной защиты.

auth/start и auth/finish вдобавок принимают короткоживущую (10 мин)
HMAC-подписанную ссылку с dashboard bek-bek (?link=<exp>.<sig>, подпись по
"<user_id>:<exp>" — так ссылку одного пользователя нельзя переиспользовать
для входа в чужой user_id, см. require_token_or_link). Синхронный
garminconnect уходит в threadpool — FastAPI сам запускает обычные
def-хендлеры там, поэтому /auth/* — не async.
"""

import asyncio
import hmac
import json
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any

from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app import garmin_client, store, sync, workout_builder
from app.config import AUTH_RETURN_URL, SYNC_MIN_INTERVAL_SEC, SYNC_TOKEN, token_dir_for

_sync_locks: dict[str, asyncio.Lock] = {}


def _lock_for(user_id: str) -> asyncio.Lock:
    lock = _sync_locks.get(user_id)
    if lock is None:
        lock = _sync_locks[user_id] = asyncio.Lock()
    return lock


# Незавершённые входы (ждут код MFA): attempt_id -> (поставлено, user_id, client_state).
# В памяти процесса — переживать редеплой не нужно, вход всё равно начинают заново.
_PENDING_LOGINS: dict[str, tuple[float, str, Any]] = {}
_LOGIN_ATTEMPT_TTL_SEC = 300


def _cleanup_pending_logins() -> None:
    now = time.time()
    expired = [k for k, (ts, _, _) in _PENDING_LOGINS.items() if now - ts > _LOGIN_ATTEMPT_TTL_SEC]
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


_LINK_TOKEN_TTL_SEC = 600  # 10 минут — время на форму + код MFA


def _valid_link_token(user_id: str, token: str) -> bool:
    """Короткоживущая ссылка из bek-bek: "<exp_unix>.<hmac>", подписана тем же
    GARMIN_SYNC_TOKEN по "<user_id>:<exp>" — чужую ссылку для другого user_id
    не переиспользовать. Годится только для входа (/auth/*)."""
    if not SYNC_TOKEN or "." not in token:
        return False
    exp_str, _, sig = token.partition(".")
    if not exp_str.isdigit() or time.time() > int(exp_str):
        return False
    expected = hmac.new(SYNC_TOKEN.encode(), f"{user_id}:{exp_str}".encode(), sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


def require_token_or_link(user_id: str, request: Request) -> None:
    """Для /auth/start и /auth/finish: обычный GARMIN_SYNC_TOKEN (ручной ввод,
    серверные вызовы) ИЛИ короткоживущая подписанная ссылка с dashboard bek-bek."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="нужен Authorization: Bearer <...>")
    presented = auth.removeprefix("Bearer ")
    if SYNC_TOKEN and presented == SYNC_TOKEN:
        return
    if _valid_link_token(user_id, presented):
        return
    raise HTTPException(status_code=401, detail="неверный или истёкший токен/ссылка")


def _seconds_since(iso: str) -> float:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds()


@app.get("/health")
def health() -> dict:
    """Общая живость процесса — для Dokploy/мониторинга, без привязки к пользователю."""
    return {"ok": True}


@app.get("/users/{user_id}/health")
def user_health(user_id: str) -> dict:
    return {
        "ok": True,
        "last_sync_at": store.get_meta(user_id, "last_sync_at"),
        "garmin_logged_in": (token_dir_for(user_id) / "garmin_tokens.json").exists(),
    }


@app.post("/users/{user_id}/sync")
async def do_sync(user_id: str, _: None = Depends(require_token)) -> dict:
    last = store.get_meta(user_id, "last_sync_at")
    if last and _seconds_since(last) < SYNC_MIN_INTERVAL_SEC:
        return {"checked_at": last, "downloaded": [], "failed": [], "throttled": True}
    lock = _lock_for(user_id)
    if lock.locked():  # второй параллельный вызов того же пользователя не ждёт и не ходит в Garmin
        return {"checked_at": last, "downloaded": [], "failed": [], "throttled": True, "busy": True}
    async with lock:
        try:
            result = await run_in_threadpool(sync.sync_once, user_id)
        except garmin_client.NotLoggedInError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
    return {**result, "throttled": False}


@app.post("/users/{user_id}/sync/history")
async def do_sync_history(user_id: str, count: int = 10, _: None = Depends(require_token)) -> dict:
    """Подгрузка истории по клику «+10 тренировок» в bek-bek — без троттлинга
    по времени (это явное действие пользователя, не автоматика): только lock,
    чтобы не столкнуться с обычным /sync того же user_id."""
    lock = _lock_for(user_id)
    if lock.locked():
        return {"downloaded": [], "failed": [], "busy": True}
    async with lock:
        try:
            result = await run_in_threadpool(sync.sync_history, user_id, count)
        except garmin_client.NotLoggedInError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
    return {**result, "busy": False}


@app.get("/users/{user_id}/activities")
def activities(user_id: str, since: str | None = None, _: None = Depends(require_token)) -> list[dict]:
    fields = ("activity_id", "start_time", "activity_type", "name", "sha256", "size_bytes", "status")
    return [{k: row[k] for k in fields} for row in store.list_activities(user_id, since)]


@app.get("/users/{user_id}/activities/{activity_id}/fit")
def activity_fit(user_id: str, activity_id: str, _: None = Depends(require_token)) -> Response:
    row = store.get(user_id, activity_id)
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


class PaceRangeBody(BaseModel):
    fast: str
    slow: str


class StepConditionBody(BaseModel):
    type: Literal["time", "distance", "lapButton"]
    durationSec: float | None = None
    distanceM: float | None = None


class RepeatChildBody(BaseModel):
    kind: Literal["interval", "recovery"]
    condition: StepConditionBody
    pace: PaceRangeBody | None = None


class WorkoutBlockBody(BaseModel):
    kind: Literal["warmup", "cooldown", "interval", "recovery", "repeat"]
    condition: StepConditionBody | None = None
    pace: PaceRangeBody | None = None
    iterations: int | None = None
    steps: list[RepeatChildBody] | None = None


class CreateWorkoutBody(BaseModel):
    workoutName: str
    blocks: list[WorkoutBlockBody]


@app.post("/users/{user_id}/workouts")
async def create_workout(
    user_id: str, body: CreateWorkoutBody, _: None = Depends(require_token)
) -> dict:
    """Собирает и грузит структурированную тренировку (бег) из схемы
    конструктора bek-bek — см. app/workout_builder.py. Условие окончания у
    каждого шага — время/дистанция/кнопка круга (StepCondition в
    src/lib/structured-workouts/model.ts, та же модель)."""
    try:
        api = await run_in_threadpool(garmin_client.connect, token_dir_for(user_id))
    except garmin_client.NotLoggedInError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    blocks = [b.model_dump(exclude_none=True) for b in body.blocks]
    try:
        created = await run_in_threadpool(
            workout_builder.build_and_upload, api, body.workoutName, blocks
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        "workoutId": created.get("workoutId"),
        "workoutName": created.get("workoutName"),
    }


class AuthStartBody(BaseModel):
    email: str
    password: str


class AuthFinishBody(BaseModel):
    attempt_id: str
    code: str


@app.post("/users/{user_id}/auth/start", dependencies=[Depends(require_token_or_link)])
def auth_start(user_id: str, body: AuthStartBody) -> dict:
    """Шаг 1 входа (см. PLAN.md — обновление токена, вариант А)."""
    _cleanup_pending_logins()
    try:
        needs_mfa, client_state = garmin_client.start_login(
            body.email, body.password, token_dir_for(user_id)
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not needs_mfa:
        return {"needs_mfa": False}
    attempt_id = secrets.token_urlsafe(16)
    _PENDING_LOGINS[attempt_id] = (time.time(), user_id, client_state)
    return {"needs_mfa": True, "attempt_id": attempt_id}


@app.post("/users/{user_id}/auth/finish", dependencies=[Depends(require_token_or_link)])
def auth_finish(user_id: str, body: AuthFinishBody) -> dict:
    """Шаг 2: код MFA довершает вход, начатый /auth/start."""
    _cleanup_pending_logins()
    entry = _PENDING_LOGINS.pop(body.attempt_id, None)
    if not entry or entry[1] != user_id:
        raise HTTPException(
            status_code=400, detail="Попытка входа не найдена или истекла — начните заново"
        )
    _, _, client_state = entry
    try:
        garmin_client.finish_login(client_state, body.code, token_dir_for(user_id))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}


_AUTH_PAGE_TEMPLATE = """<!doctype html>
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
  #mfa-block, #token-block { display: none; }
</style>
</head>
<body>
<h3>garmin-sync — обновить вход в Garmin</h3>
<p id="intro">Email и пароль Garmin никуда кроме этого сервиса не уходят —
страница шлёт их напрямую на этот же домен.</p>

<div id="start-block">
  <div id="token-block">
    <label>Токен сервиса <input id="token" type="password" autocomplete="off"></label>
  </div>
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
const RETURN_URL = __RETURN_URL_JSON__;
// Путь вида /users/<id>/auth — свой user_id для каждого человека.
const userId = location.pathname.split('/')[2];
const linkToken = new URLSearchParams(location.search).get('link');
let attemptId = null;

if (linkToken) {
  document.getElementById('intro').textContent =
    'Вы уже авторизованы через bek-bek — просто введите email и пароль Garmin.';
} else {
  document.getElementById('token-block').style.display = 'block';
}

function authHeader() {
  return linkToken || document.getElementById('token').value;
}

function msg(text, cls) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = cls || '';
}

function onSuccess() {
  if (RETURN_URL) {
    msg('Готово — вход выполнен. Возвращаемся в bek-bek…', 'ok');
    setTimeout(() => { location.href = RETURN_URL; }, 1500);
  } else {
    msg('Готово — вход выполнен, токены сохранены.', 'ok');
  }
}

document.getElementById('start-btn').onclick = async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  msg('Входим…');
  try {
    const res = await fetch(`/users/${userId}/auth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authHeader() },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) { msg(data.detail || 'Ошибка входа', 'err'); return; }
    if (data.needs_mfa) {
      attemptId = data.attempt_id;
      document.getElementById('mfa-block').style.display = 'block';
      msg('Введите код MFA — он уже должен прийти.', 'ok');
    } else {
      onSuccess();
    }
  } catch (e) {
    msg('Сеть недоступна: ' + e, 'err');
  }
};

document.getElementById('finish-btn').onclick = async () => {
  const code = document.getElementById('code').value;
  msg('Подтверждаем код…');
  try {
    const res = await fetch(`/users/${userId}/auth/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authHeader() },
      body: JSON.stringify({ attempt_id: attemptId, code }),
    });
    const data = await res.json();
    if (!res.ok) { msg(data.detail || 'Ошибка подтверждения', 'err'); return; }
    onSuccess();
  } catch (e) {
    msg('Сеть недоступна: ' + e, 'err');
  }
};
</script>
</body>
</html>"""

_AUTH_PAGE = _AUTH_PAGE_TEMPLATE.replace("__RETURN_URL_JSON__", json.dumps(AUTH_RETURN_URL))


@app.get("/users/{user_id}/auth", response_class=HTMLResponse)
def auth_page(user_id: str) -> str:
    """Форма обновления токена Garmin для конкретного user_id (страница одна
    и та же для всех — JS сам берёт user_id из пути). Не секрет сама по себе —
    ничего не отправляет и не показывает без GARMIN_SYNC_TOKEN (или подписанной
    ссылки с dashboard bek-bek, см. require_token_or_link) в поле."""
    return _AUTH_PAGE
