import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 работает через driver adapter (node-postgres).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  // На Layero строку подключения к базе платформа кладёт в LAYERO_DATABASE_URL
  // (в DATABASE_URL она не пишет, чтобы не перекрыть переменную пользователя).
  // Локально этой переменной нет — берём DATABASE_URL из .env.local.
  const connectionString =
    process.env.LAYERO_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Не задан LAYERO_DATABASE_URL или DATABASE_URL");
  }

  // TLS задаётся самой строкой: у базы Layero в ней sslmode, а сертификат
  // (Let's Encrypt) node-pg проверяет по системным корням Node. Локальный
  // Postgres — строка без sslmode, без шифрования.
  const adapter = new PrismaPg({
    connectionString,
    max: 3, // маленький пул под serverless
  });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function getClient(): PrismaClient {
  // Singleton через globalThis — не плодим подключения при hot-reload и на
  // нескольких pod'ах serverless.
  const client = globalForPrisma.prisma ?? createClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

// Ленивый прокси: реальный клиент создаётся только при первом обращении (в
// рантайме запроса), а не при импорте модуля во время `next build`.
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
