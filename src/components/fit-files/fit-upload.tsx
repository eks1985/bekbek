"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function FitUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setPending(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/fit-files", { method: "POST", body });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error ?? "Не удалось загрузить файл");
        return;
      }

      toast.success(`Файл «${data.originalName}» загружен`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh(); // перечитать список файлов на сервере
    } catch {
      toast.error("Сеть недоступна. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Загрузка тренировки</CardTitle>
        <CardDescription>FIT-файл с часов, до 10 МБ.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={upload} className="flex flex-col gap-3 sm:flex-row">
          <Input
            ref={inputRef}
            type="file"
            accept=".fit"
            disabled={pending}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button type="submit" disabled={!file || pending}>
            {pending ? "Загружаем…" : "Загрузить"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
