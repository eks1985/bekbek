"""Однократный вход в Garmin Connect: спрашивает email, пароль и код MFA
(если включён) и сохраняет токены в GARMIN_TOKEN_DIR. Пароль нигде не хранится.

    python -m scripts.login

На сервере — внутри контейнера, чтобы токены легли на volume:
    docker exec -it <контейнер> python -m scripts.login
"""

import getpass

from garminconnect import Garmin

from app.config import TOKEN_DIR


def main() -> None:
    email = input("Email Garmin: ").strip()
    password = getpass.getpass("Пароль Garmin: ")

    api = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input("Код MFA из письма/приложения: ").strip(),
    )
    # Файла токенов ещё нет → библиотека войдёт по паролю и запишет
    # TOKEN_DIR/garmin_tokens.json (права 600, папка 700).
    api.login(str(TOKEN_DIR))

    # Если обмен тикета на DI-токен не прошёл (diauth.garmin.com недоступен),
    # библиотека может «войти» через cookie веб-портала — но на диск сохраняются
    # только DI-токены, и следующий запуск снова потребует пароль. Не делаем
    # вид, что всё хорошо.
    token_file = TOKEN_DIR / "garmin_tokens.json"
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
