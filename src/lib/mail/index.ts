import type { Mailer } from "./types";
import { consoleMailer } from "./console";
import { createNotisendMailer } from "./notisend";

// Фабрика мейлера по переменной окружения MAILER.
// По умолчанию — console: проект работает сразу, без аккаунта почты.
let cached: Mailer | null = null;

export function getMailer(): Mailer {
  if (cached) return cached;

  const provider = (process.env.MAILER ?? "console").toLowerCase();

  switch (provider) {
    case "notisend":
      cached = createNotisendMailer();
      break;
    case "console":
    default:
      cached = consoleMailer;
      break;
  }

  return cached;
}

export type { Mailer } from "./types";
