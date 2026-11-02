"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type GarminSyncResponse = {
  imported: number;
  skipped: number;
  errors: number;
  more: boolean;
};

/**
 * Рендерится только владельцу (см. dashboard/page.tsx — сверка с GARMIN_OWNER_EMAIL
 * серверная). После монтирования тихо дёргает синк в фоне: страница не ждёт
 * ответа Garmin, при новых тренировках — toast и обновление списка.
 */
export function GarminSyncOnOpen() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return; // не запускать второй раз при повторном монтировании
    startedRef.current = true;

    let cancelled = false;

    async function syncOnce(): Promise<void> {
      let data: GarminSyncResponse;
      try {
        const res = await fetch("/api/garmin/sync", { method: "POST" });
        if (!res.ok || cancelled) return;
        data = await res.json();
      } catch {
        return; // фоновая проверка — сетевые сбои молча пропускаем
      }
      if (cancelled) return;

      if (data.imported > 0) {
        toast.success(
          data.imported === 1
            ? "Загружена новая тренировка из Garmin"
            : `Загружено ${data.imported} новых тренировок из Garmin`,
        );
        router.refresh();
      }
      if (data.more) {
        await syncOnce(); // есть ещё — добираем остаток пачками
      }
    }

    void syncOnce().finally(() => {
      if (!cancelled) setChecking(false);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!checking) return null;
  return <p className="text-xs text-muted-foreground">Проверяю Garmin…</p>;
}
