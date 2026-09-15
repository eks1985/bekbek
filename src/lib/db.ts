import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 работает через driver adapter (node-postgres).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL не задан");
  }

  // TLS для Yandex Managed PostgreSQL: node-pg не читает sslrootcert из URL,
  // поэтому CA передаём файлом. Путь — в DATABASE_CA_PATH (см. certs/README.md).
  // Без переменной (локальный Postgres) идём без ssl.
  const caPath = process.env.DATABASE_CA_PATH;
  const ssl = caPath
    ? { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true }
    : undefined;

  const adapter = new PrismaPg({
    connectionString,
    max: 3, // маленький пул под serverless
    ssl,
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
