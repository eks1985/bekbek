import Link from "next/link";
import { CirclePlay } from "lucide-react";
import { listFitFiles, type FitFileListItem } from "@/lib/fit-files/queries";
import { Button } from "@/components/ui/button";
import { GarminHistoryButton } from "@/components/garmin/garmin-history-button";
import {
  Card,
  CardAction,
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
        <CardAction>
          <GarminHistoryButton />
        </CardAction>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">Файлов пока нет.</p>
        ) : (
          <table className="w-full text-sm">
            {files.map((file) => (
              <FitFileRow key={file.id} file={file} />
            ))}
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function FitFileRow({ file }: { file: FitFileListItem }) {
  const { workout } = file;
  const tag = workout?.workoutTag;

  // Запись — три «этажа» в одном <tbody>: дата/расстояние/иконка, имя файла, тег.
  // Так в строке остаются три колонки и на узком экране всё помещается.
  return (
    <tbody
      className="border-b last:border-0"
      // Размер и дату загрузки держим в подсказке, чтобы не плодить колонки.
      title={`${formatSize(file.sizeBytes)}, загружен ${dateFormat.format(file.uploadedAt)}`}
    >
      <tr>
        <td className="pt-2 whitespace-nowrap tabular-nums">
          {workout ? (
            dateFormat.format(workout.startTime)
          ) : (
            <span className="text-muted-foreground">не разобран</span>
          )}
        </td>
        <td className="pt-2 text-center whitespace-nowrap tabular-nums">
          {formatDistance(workout?.distanceM ?? null)}
        </td>
        <td className="pt-2 text-right">
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
      <tr>
        {/* max-w-0 + w-full: ячейка не растягивает таблицу, длинное имя обрезается. */}
        <td
          colSpan={3}
          className={`w-full  max-w-0 truncate text-xs text-muted-foreground ${tag ? "" : "pb-2"}`}
        >
          {file.originalName}
        </td>
      </tr>
      <tr>
        <td colSpan={3} className="pt-1 pb-2 text-center font-mono text-sm font-semibold">
          {tag || "Схема интервалов не найдена"}
        </td>
      </tr>
    </tbody>
  );
}
