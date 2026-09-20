import "server-only";
import { db } from "@/lib/db";

/** Все FIT-файлы пользователя, новые сверху (индекс userId+uploadedAt). */
export function listFitFiles(userId: string) {
  return db.fitFile.findMany({
    where: { userId },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      originalName: true,
      sizeBytes: true,
      uploadedAt: true,
    },
  });
}
