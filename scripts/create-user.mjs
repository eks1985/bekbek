// Заводит пользователя (вход разрешён только заранее зарегистрированным).
// Использование: npm run user:add -- you@example.com
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

// Та же база, что у приложения (см. src/lib/db.ts): LAYERO_DATABASE_URL, иначе DATABASE_URL.
const connectionString =
  process.env.LAYERO_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Не задан LAYERO_DATABASE_URL или DATABASE_URL (проверьте .env.local)");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const db = new PrismaClient({ adapter });

const user = await db.user.upsert({
  where: { email },
  update: {},
  create: { email },
});

console.log(`Пользователь готов: ${user.email} (id ${user.id})`);
await db.$disconnect();
