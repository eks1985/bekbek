"""Синхронизация руками (шаг 2): python -m scripts.sync_cli.
На сервере то же самое делает POST /sync."""

import json

from app import store, sync


def main() -> None:
    store.init()
    print(json.dumps(sync.sync_once(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
