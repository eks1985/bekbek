# Сертификаты

Для боевого подключения к **Yandex Managed PostgreSQL** нужен корневой CA
Яндекса (сервер предъявляет сертификат, подписанный не Let's Encrypt, а YC).

Скачайте его сюда как `yandex-root.crt`:

```bash
curl -fsSL https://storage.yandexcloud.net/cloud-certs/CA.pem -o certs/yandex-root.crt
```

Затем укажите путь к нему в переменной окружения:

```
DATABASE_CA_PATH="./certs/yandex-root.crt"
```

node-pg (драйвер под Prisma 7) не читает `sslrootcert` из строки подключения,
поэтому CA передаётся файлом через `DATABASE_CA_PATH` — см. `src/lib/db.ts`.

Файл `*.crt` намеренно **не** игнорируется git — он должен попасть в образ,
который собирает Layero (без него `verify-full` не подключится).

Локальному Postgres сертификат не нужен — там строка без `sslmode`.
