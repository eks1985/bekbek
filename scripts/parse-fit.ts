// Разбирает FIT-файлы тренировок и сохраняет результат в output/<имя>.json.
// Использование:
//   npm run fit:parse -- samples/activity.fit
//   npm run fit:parse -- samples/                          (все .fit в папке)
//   npm run fit:parse -- file.fit --with-points            (с посекундными точками)
//   npm run fit:parse -- file.fit --out results            (другая папка вывода)
//   npm run fit:parse -- file.fit --workout auto           (найти схему интервалов)
//   npm run fit:parse -- file.fit --workout auto --tolerance 3
//   npm run fit:parse -- file.fit --workout auto --warmup 3   (разминка — первые 3 круга)
//   npm run fit:parse -- file.fit --workout "200 400 600x3"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_TOLERANCE_PCT,
  WorkoutPatternError,
  parseWorkout,
  parseWorkoutPattern,
  type ParsedWorkout,
  type WorkoutOption,
} from "../src/lib/fit";

class ArgsError extends Error {}

async function main(): Promise<number> {
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ArgsError || error instanceof WorkoutPatternError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  const { inputs, outDir, ...parseOptions } = options;

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
      const workout = parseWorkout(bytes, { fileName: path.basename(file), ...parseOptions });
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
  let includePoints = false;
  let outDir = "output";
  let workout: WorkoutOption | undefined;
  let tolerancePct = DEFAULT_TOLERANCE_PCT;
  let warmupLaps: number | undefined;

  const valueOf = (i: number, flag: string) => {
    const value = args[i];
    if (value === undefined) throw new ArgsError(`После ${flag} нужно значение`);
    return value;
  };

  assertNpmDidNotTakeFlags(args);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      // Лишний разделитель от `npm run fit:parse -- -- …` (обход для PowerShell).
      continue;
    } else if (arg === "--with-points") {
      includePoints = true;
    } else if (arg === "--out") {
      outDir = valueOf(++i, arg);
    } else if (arg === "--workout") {
      const value = valueOf(++i, arg);
      workout = value === "auto" ? "auto" : parseWorkoutPattern(value);
    } else if (arg === "--tolerance") {
      tolerancePct = Number(valueOf(++i, arg));
      if (!(tolerancePct > 0 && tolerancePct < 50)) {
        throw new ArgsError("--tolerance — процент больше 0 и меньше 50, например --tolerance 5");
      }
    } else if (arg === "--warmup") {
      warmupLaps = Number(valueOf(++i, arg));
      if (!Number.isInteger(warmupLaps) || warmupLaps < 0) {
        throw new ArgsError("--warmup — число кругов разминки: целое, 0 или больше, например --warmup 3");
      }
    } else if (arg.startsWith("--")) {
      throw new ArgsError(`Неизвестный флаг ${arg}`);
    } else {
      inputs.push(arg);
    }
  }

  if (inputs.length === 0) {
    throw new ArgsError("Укажите FIT-файл или папку: npm run fit:parse -- samples/activity.fit");
  }
  if (warmupLaps !== undefined && workout !== "auto") {
    // В ручной схеме разминка — всегда первый круг, в полной разметке задаётся сама.
    throw new ArgsError("--warmup работает только с --workout auto");
  }
  return { inputs, outDir, includePoints, workout, tolerancePct, warmupLaps };
}

/**
 * PowerShell при вызове npm (npm.ps1) выкидывает разделитель `--`, и npm
 * забирает флаги себе: `--workout auto` превращается в настройку npm, а в
 * скрипт доходит только "auto". npm при этом кладёт перехваченные флаги
 * в переменные npm_config_*. Если видим такую — лучше честно упасть, чем
 * молча разобрать файл без схемы.
 */
function assertNpmDidNotTakeFlags(args: string[]) {
  const flags = ["workout", "with-points", "tolerance", "warmup", "out"];
  const taken = flags.filter(
    (flag) =>
      process.env[`npm_config_${flag.replace("-", "_")}`] !== undefined &&
      !args.includes(`--${flag}`),
  );
  if (taken.length === 0) return;

  throw new ArgsError(
    `Флаги ${taken.map((f) => `--${f}`).join(", ")} не дошли до скрипта: их перехватил npm ` +
      "(PowerShell убирает разделитель --).\nЗапустите одним из способов:\n" +
      "  npm run fit:parse -- -- samples/файл.fit --workout auto\n" +
      "  npx tsx scripts/parse-fit.ts samples/файл.fit --workout auto",
  );
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

function printSummary(
  file: string,
  outFile: string,
  { summary: s, workout, laps, kmSplits }: ParsedWorkout,
) {
  const km = s.distanceM === null ? "—" : (s.distanceM / 1000).toFixed(2);
  console.log(`✓ ${file} → ${path.relative(process.cwd(), outFile)}`);
  console.log(
    `  ${s.startTimeLocal ?? s.startTime} · ${s.sport ?? "?"} · ${km} км · ${s.duration ?? "—"} · ` +
      `темп ${s.avgPace ?? "—"}/км · пульс ${s.avgHeartRate ?? "—"} · ` +
      `набор ${s.totalAscentM ?? "—"} м · кругов ${laps.length} · ` +
      `сплитов ${kmSplits.items.length} (${kmSplits.source})`,
  );
  if (workout) {
    const pace = workout.adjustedAvgPace ? ` · темп отрезков ${workout.adjustedAvgPace}/км` : "";
    const noTag = workout.source === "auto" ? "не найдена" : "не задана";
    const warmup = workout.warmupLaps === null ? "" : `, разминка — кругов: ${workout.warmupLaps}`;
    console.log(`  схема: ${workout.tag ?? noTag} (${workout.source}${warmup})${pace}`);
    for (const warning of workout.warnings) console.log(`  ⚠ ${warning}`);
  }
}

main().then((code) => {
  process.exitCode = code;
});
