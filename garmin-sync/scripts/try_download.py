"""Шаг 1, проверка руками: список последних активностей и скачивание
оригинального FIT одной из них. Ничего не запоминает — это прототип.

    python -m scripts.try_download <user_id>               # последняя активность
    python -m scripts.try_download <user_id> 123456789     # конкретная по id
"""

import sys

from app.config import fit_dir_for, token_dir_for
from app.garmin_client import connect, download_fit, list_recent, sha256_hex


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Нужен user_id: python -m scripts.try_download <user_id> [activity_id]")
    user_id = sys.argv[1]
    api = connect(token_dir_for(user_id))

    activities = list_recent(api, limit=10)
    print("Последние активности:")
    for a in activities:
        km = f"{a.distance_m / 1000:.2f} км" if a.distance_m else "—"
        print(f"  {a.activity_id}  {a.start_time_local}  {a.activity_type or '—':<16}  {km:>9}  {a.name}")

    if len(sys.argv) > 2:
        activity_id = int(sys.argv[2])
    elif activities:
        activity_id = activities[0].activity_id
    else:
        print("Активностей нет — скачивать нечего.")
        return

    data = download_fit(api, activity_id)
    fit_dir = fit_dir_for(user_id)
    fit_dir.mkdir(parents=True, exist_ok=True)
    path = fit_dir / f"{activity_id}.fit"
    path.write_bytes(data)
    print(f"\nСкачано: {path}  ({len(data)} байт, sha256 {sha256_hex(data)})")


if __name__ == "__main__":
    main()
