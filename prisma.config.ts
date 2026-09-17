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

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
