import Link from "next/link";
import { ChevronLeft, ChevronRight, CirclePlay } from "lucide-react";
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

/** Серверный компонент: список FIT-файлов пользователя из БД, по страницам. */
export async function FitFileList({ userId, page = 1 }: { userId: string; page?: number }) {
  const { files, total, page: currentPage, pageCount } = await listFitFiles(userId, page);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Загруженные файлы</CardTitle>
        <CardDescription>Всего: {total}</CardDescription>
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
      {pageCount > 1 && <FitFilePagination page={currentPage} pageCount={pageCount} />}
    </Card>
  );
}

function pageHref(page: number): string {
  return page <= 1 ? "/dashboard" : `/dashboard?page=${page}`;
}

function FitFilePagination({ page, pageCount }: { page: number; pageCount: number }) {
  return (
    <div className="flex items-center justify-center gap-3 border-t pt-3">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={page <= 1}
        nativeButton={page <= 1}
        render={page <= 1 ? undefined : <Link href={pageHref(page - 1)} aria-label="Предыдущая страница" />}
      >
        <ChevronLeft />
      </Button>
      <span className="text-sm text-muted-foreground tabular-nums">
        Страница {page} из {pageCount}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={page >= pageCount}
        nativeButton={page >= pageCount}
        render={page >= pageCount ? undefined : <Link href={pageHref(page + 1)} aria-label="Следующая страница" />}
      >
        <ChevronRight />
      </Button>
    </div>
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
