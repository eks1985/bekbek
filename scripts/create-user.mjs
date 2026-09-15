// Заводит пользователя (вход разрешён только заранее зарегистрированным).
// Использование: npm run user:add -- you@example.com
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Скрипт запускается напрямую node — подгружаем env сами.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
    break;
  } catch {
    // нет файла — идём дальше
  }
}

const raw = process.argv[2];
if (!raw) {
  console.error("Укажите email: npm run user:add -- you@example.com");
  process.exit(1);
}

const email = raw.trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error(`Некорректный email: ${raw}`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL не задан (проверьте .env.local)");
  process.exit(1);
}

const caPath = process.env.DATABASE_CA_PATH;
const ssl = caPath
  ? { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true }
  : undefined;

const adapter = new PrismaPg({ connectionString, ssl });
const db = new PrismaClient({ adapter });

const user = await db.user.upsert({
  where: { email },
  update: {},
  create: { email },
});

console.log(`Пользователь готов: ${user.email} (id ${user.id})`);
await db.$disconnect();
