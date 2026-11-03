"""Однократный вход в Garmin Connect: спрашивает email, пароль и код MFA
(если включён) и сохраняет токены в TOKEN_DIR/<user_id>. Пароль нигде не хранится.

    python -m scripts.login <user_id>

На сервере — внутри контейнера, чтобы токены легли на volume:
    docker exec -it <контейнер> python -m scripts.login <user_id>

В обычной работе входить проще через /users/<user_id>/auth в браузере —
этот скрипт для разовой отладки без веб-формы.
"""

import getpass
import sys

from garminconnect import Garmin

from app.config import token_dir_for


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Нужен user_id: python -m scripts.login <user_id>")
    token_dir = token_dir_for(sys.argv[1])

    email = input("Email Garmin: ").strip()
    password = getpass.getpass("Пароль Garmin: ")

    api = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input("Код MFA из письма/приложения: ").strip(),
    )
    # Файла токенов ещё нет → библиотека войдёт по паролю и запишет
    # token_dir/garmin_tokens.json (права 600, папка 700).
    api.login(str(token_dir))

    # Если обмен тикета на DI-токен не прошёл (diauth.garmin.com недоступен),
    # библиотека может «войти» через cookie веб-портала — но на диск сохраняются
    # только DI-токены, и следующий запуск снова потребует пароль. Не делаем
    # вид, что всё хорошо.
    token_file = token_dir / "garmin_tokens.json"
    if not (api.client.di_token and api.client.di_refresh_token and token_file.exists()):
        token_file.unlink(missing_ok=True)
        raise SystemExit(
            "Пароль принят, но DI-токен не получен — сохранять нечего.\n"
            "Скорее всего, из этой сети недоступен diauth.garmin.com. "
            "Проверьте: python -m scripts.check_network"
        )

    print(f"Готово: вошли как {api.get_full_name() or api.display_name}.")
    print(f"Токены: {token_file}")


if __name__ == "__main__":
    main()
