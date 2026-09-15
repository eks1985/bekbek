import { defineConfig } from "prisma/config";

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
