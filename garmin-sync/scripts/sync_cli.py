"""Синхронизация руками: python -m scripts.sync_cli <user_id>.
На сервере то же самое делает POST /users/<user_id>/sync."""

import json
import sys

from app import store, sync


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Нужен user_id: python -m scripts.sync_cli <user_id>")
    store.init()
    print(json.dumps(sync.sync_once(sys.argv[1]), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
