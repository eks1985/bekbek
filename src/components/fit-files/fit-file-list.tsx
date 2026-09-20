import { listFitFiles } from "@/lib/fit-files/queries";
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
          <ul className="flex flex-col divide-y">
            {files.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-4 py-2 text-sm"
              >
                <span className="truncate font-medium">{f.originalName}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatSize(f.sizeBytes)} · {dateFormat.format(f.uploadedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
