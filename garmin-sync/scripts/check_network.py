"""Проверка сети до Garmin без логина: DNS и HTTPS до каждого хоста, через
который идёт вход и работа с API. Только stdlib — запускается до pip install.

    python -m scripts.check_network

Любой HTTP-ответ (даже 403/404) — хост доступен. Таймаут или ошибка DNS —
из этой сети войти не получится (так было на ПК в РФ: diauth.garmin.com —
таймаут).

mobile.integration.garmin.com здесь нет намеренно: это не сервер, а адрес-
идентификатор сервиса для тикета входа, в DNS его нет ни у кого (NXDOMAIN).
Ошибка «Could not resolve host» про него в логе входа — шум запасного пути.
"""

import socket
import ssl
import sys
import time
import urllib.error
import urllib.request

HOSTS = [
    ("sso.garmin.com", "вход по паролю, выдача тикета"),
    ("diauth.garmin.com", "обмен тикета на токен — без него токены не сохранить"),
    ("connectapi.garmin.com", "API: список активностей, скачивание FIT"),
    ("connect.garmin.com", "веб-портал, запасной путь входа"),
]
TIMEOUT_SEC = 10


def check(host: str) -> tuple[bool, str]:
    try:
        ip = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)[0][4][0]
    except socket.gaierror as e:
        return False, f"DNS: не резолвится ({e})"

    started = time.monotonic()
    req = urllib.request.Request(f"https://{host}/", method="GET",
                                 headers={"User-Agent": "garmin-sync/check"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC,
                                    context=ssl.create_default_context()) as resp:
            status = resp.status
    except urllib.error.HTTPError as e:
        status = e.code  # сервер ответил — для проверки сети этого достаточно
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        reason = getattr(e, "reason", e)
        return False, f"{ip}: HTTPS не отвечает ({reason})"
    ms = (time.monotonic() - started) * 1000
    return True, f"{ip}: HTTP {status}, {ms:.0f} мс"


def main() -> None:
    failed = 0
    for host, purpose in HOSTS:
        ok, detail = check(host)
        failed += not ok
        print(f"{'OK  ' if ok else 'FAIL'}  {host:<32} {detail}")
        if not ok:
            print(f"      ↳ нужен для: {purpose}")
    if failed:
        print(f"\nНедоступно хостов: {failed}. Входить из этой сети бессмысленно.")
        sys.exit(1)
    print("\nВсе хосты Garmin доступны — можно входить: python -m scripts.login")


if __name__ == "__main__":
    main()
