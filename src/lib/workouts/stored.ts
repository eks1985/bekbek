// Результат разбора, как он лежит в workouts.data: это ParsedWorkout без
// посекундных точек (их в базу не пишем, см. workoutRow).
import type { Prisma } from "@prisma/client";
import type { ParsedWorkout } from "@/lib/fit";

export type StoredWorkout = Omit<ParsedWorkout, "points">;

/**
 * jsonb → типизированный результат. Prisma отдаёт Json как JsonValue, и каст
 * нужен ровно один — здесь, а не в каждом компоненте. Формат данных отвечает
 * parserVersion из to-row.ts: если он вырос, старые записи могут отличаться.
 */
export function readStoredWorkout(data: Prisma.JsonValue): StoredWorkout {
  return data as unknown as StoredWorkout;
}
