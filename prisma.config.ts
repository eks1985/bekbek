import { defineConfig } from "prisma/config";

// Этот файл  это конфиг для CLI-команд Prisma (prisma migrate, prisma generate, prisma studio),
// Само приложение его не трогает

// Когда запускаем cli команду то подхватываются данные из переменных окружения
// на хостинге этот файл никак не задействуется

// Prisma 7 при наличии этого файла НЕ грузит .env автоматически.
// Подхватываем .env.local / .env встроенным загрузчиком Node 22 (без deps).
// На Layero/CI переменные уже есть в process.env — тогда просто пропускаем.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // файла нет — идём дальше
  }
}

// Схема та же, что в src/lib/db.ts (DB_SCHEMA): миграции обязаны создавать
// таблицы там же, где их ищет приложение.
const DB_SCHEMA = "bekbek";

/** Добавляет к строке подключения ?schema=<DB_SCHEMA>, не трогая остальное. */
function withSchema(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const parsed = new URL(url);
  parsed.searchParams.set("schema", DB_SCHEMA);
  return parsed.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Та же база, что у приложения (см. src/lib/db.ts).
    url: withSchema(process.env.LAYERO_DATABASE_URL || process.env.DATABASE_URL),
  },
});
