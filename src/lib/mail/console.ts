import type { Mailer } from "./types";

// Dev-адаптер: печатает код в консоль сервера вместо реальной отправки.
// Позволяет пройти весь флоу входа без почтового аккаунта.
export const consoleMailer: Mailer = {
  async sendCode(email, code) {
    console.log(
      `\n[mail:console] Код для ${email}: ${code} (действует 10 минут)\n`,
    );
  },
};
