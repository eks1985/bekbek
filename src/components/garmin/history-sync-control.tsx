"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type HistoryStatus = {
  active: boolean;
  offset: number;
  rate_per_hour: number;
};

const POLL_INTERVAL_MS = 30000;

/** Тумблер фоновой подгрузки всей истории Garmin — garmin-sync сам тянет по
 * одной тренировке в ~rate_per_hour час, пока не кончится история, см.
 * garmin-sync/app/main.py (_history_loop) и PLAN. */
export function HistorySyncControl({ initialStatus }: { initialStatus: HistoryStatus | null }) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const wasActiveRef = useRef(initialStatus?.active ?? false);

  useEffect(() => {
    if (!status?.active) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/garmin/history/background");
        if (!res.ok) return;
        const data: HistoryStatus = await res.json();
        if (wasActiveRef.current && !data.active) {
          toast.success("История Garmin загружена полностью");
        }
        wasActiveRef.current = data.active;
        setStatus(data);
      } catch {
        // фоновый поллинг — сетевые сбои молча пропускаем
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status?.active]);

  async function toggle() {
    setPending(true);
    try {
      const res = await fetch(`/api/garmin/history/background${status?.active ? "/disable" : ""}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Не удалось изменить настройку");
        return;
      }
      wasActiveRef.current = data.active;
      setStatus(data);
      toast.success(
        data.active ? "Фоновая загрузка истории включена" : "Фоновая загрузка истории остановлена",
      );
    } catch {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  }

  const active = status?.active ?? false;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {active && status
          ? `Включено — скачивается примерно ${status.rate_per_hour} тренировок в час.`
          : "Сейчас выключено."}
      </p>
      {active && status && (
        <p className="text-sm text-muted-foreground">Обработано тренировок: {status.offset}</p>
      )}
      <div>
        <Button onClick={toggle} disabled={pending} variant={active ? "outline" : "default"}>
          {pending ? "Подождите…" : active ? "Остановить" : "Начать загрузку истории"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Скачанные тренировки появятся на панели после следующего её открытия.
      </p>
    </div>
  );
}
