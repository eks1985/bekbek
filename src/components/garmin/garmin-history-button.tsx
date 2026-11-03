"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Подгружает следующую порцию старых тренировок из Garmin — для тех, у кого
 * ещё не загружена вся история. Каждый клик тянет ровно одну порцию. */
export function GarminHistoryButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function loadMore() {
    setPending(true);
    try {
      const res = await fetch("/api/garmin/history", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось подгрузить историю");
        return;
      }
      if (data.imported > 0) {
        toast.success(
          data.imported === 1
            ? "Загружена ещё одна тренировка"
            : `Загружено ещё ${data.imported} тренировок`,
        );
        router.refresh();
      } else if (data.hasMore === false) {
        toast.message("Это была последняя тренировка в истории Garmin");
      } else {
        toast.message("В этой порции новых тренировок не нашлось — попробуйте ещё раз");
      }
    } catch {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={loadMore} disabled={pending}>
      {pending ? "Загружаем…" : "+10 тренировок"}
    </Button>
  );
}
