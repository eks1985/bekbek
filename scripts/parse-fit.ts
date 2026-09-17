// Разбирает FIT-файлы тренировок и сохраняет результат в output/<имя>.json.
// Использование:
//   npm run fit:parse -- samples/activity.fit
//   npm run fit:parse -- samples/                 (все .fit в папке)
//   npm run fit:parse -- samples/ --no-points     (без посекундных точек)
//   npm run fit:parse -- file.fit --out results   (другая папка вывода)
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseWorkout, type ParsedWorkout } from "../src/lib/fit";

async function main(): Promise<number> {
  const { inputs, includePoints, outDir } = parseArgs(process.argv.slice(2));
  if (inputs.length === 0) {
    console.error("Укажите FIT-файл или папку: npm run fit:parse -- samples/activity.fit");
    return 1;
  }

  const files = (await Promise.all(inputs.map(collectFitFiles))).flat();
  if (files.length === 0) {
    console.error("FIT-файлы не найдены");
    return 1;
  }

  await mkdir(outDir, { recursive: true });

  let failed = 0;
  for (const file of files) {
    try {
      const bytes = await readFile(file);
      const workout = parseWorkout(bytes, { fileName: path.basename(file), includePoints });
      const outFile = path.join(outDir, `${path.parse(file).name}.json`);
      await writeFile(outFile, JSON.stringify(workout, null, 2), "utf8");
      printSummary(file, outFile, workout);
    } catch (error) {
      // Ошибка в одном файле не останавливает остальные.
      failed++;
      console.error(`✗ ${file}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return failed > 0 ? 1 : 0;
}

function parseArgs(args: string[]) {
  const inputs: string[] = [];
  let includePoints = true;
  let outDir = "output";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--no-points") includePoints = false;
    else if (args[i] === "--out") outDir = args[++i] ?? outDir;
    else inputs.push(args[i]);
  }
  return { inputs, includePoints, outDir };
}

/** Файл → [файл]; папка → все .fit в ней. */
async function collectFitFiles(input: string): Promise<string[]> {
  const info = await stat(input).catch(() => null);
  if (!info) {
    console.error(`✗ Не найдено: ${input}`);
    return [];
  }
  if (info.isFile()) return [input];
  const entries = await readdir(input);
  return entries
    .filter((name) => name.toLowerCase().endsWith(".fit"))
    .map((name) => path.join(input, name));
}

function printSummary(file: string, outFile: string, { summary: s, laps, kmSplits }: ParsedWorkout) {
  const km = s.distanceM === null ? "—" : (s.distanceM / 1000).toFixed(2);
  console.log(`✓ ${file} → ${path.relative(process.cwd(), outFile)}`);
  console.log(
    `  ${s.startTimeLocal ?? s.startTime} · ${s.sport ?? "?"} · ${km} км · ${s.duration ?? "—"} · ` +
      `темп ${s.avgPace ?? "—"}/км · пульс ${s.avgHeartRate ?? "—"} · ` +
      `набор ${s.totalAscentM ?? "—"} м · кругов ${laps.length} · ` +
      `сплитов ${kmSplits.items.length} (${kmSplits.source})`,
  );
}

main().then((code) => {
  process.exitCode = code;
});
