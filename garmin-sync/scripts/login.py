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

    print(f"Готово: вошли как {api.get_full_name() or api.display_name}.")
    print(f"Токены: {TOKEN_DIR / 'garmin_tokens.json'}")


if __name__ == "__main__":
    main()
