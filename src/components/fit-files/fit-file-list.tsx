import Link from "next/link";
import { CirclePlay } from "lucide-react";
import { listFitFiles, type FitFileListItem } from "@/lib/fit-files/queries";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function formatDistance(meters: number | null): string {
  return meters === null ? "—" : `${(meters / 1000).toFixed(2)} км`;
}

/** Серверный компонент: список FIT-файлов пользователя из БД. */
export async function FitFileList({ userId }: { userId: string }) {
  const files = await listFitFiles(userId);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Загруженные файлы</CardTitle>
        <CardDescription>Всего: {files.length}</CardDescription>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">Файлов пока нет.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Файл</th>
                <th className="py-2 font-medium">Дата</th>
                <th className="py-2 text-center font-medium">Расстояние</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <FitFileRow key={file.id} file={file} />
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function FitFileRow({ file }: { file: FitFileListItem }) {
  const { workout } = file;

  return (
    <tr
      className="border-b last:border-0"
      // Размер и дату загрузки держим в подсказке, чтобы не плодить колонки.
      title={`${formatSize(file.sizeBytes)}, загружен ${dateFormat.format(file.uploadedAt)}`}
    >
      <td className="max-w-[16rem] truncate py-2 font-medium">{file.originalName}</td>
      <td className="py-2 whitespace-nowrap tabular-nums">
        {workout ? (
          dateFormat.format(workout.startTime)
        ) : (
          <span className="text-muted-foreground">не разобран</span>
        )}
      </td>
      <td className="py-2 text-center whitespace-nowrap tabular-nums">
        {formatDistance(workout?.distanceM ?? null)}
      </td>
      <td className="py-2 text-right">
        {/* Base UI: подмена элемента — через render, не asChild.
            nativeButton={false} — внутри <a>, а не <button>. */}
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href={`/fit-files/${file.id}`} aria-label="Результат разбора" />}
        >
          <CirclePlay />
        </Button>
      </td>
    </tr>
  );
}
