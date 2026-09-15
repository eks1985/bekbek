import type { Mailer } from "./types";
import { codeEmailContent } from "./types";

// Адаптер Notisend — транзакционная отправка через HTTP API (не SMTP).
// Контракт: POST https://api.notisend.ru/v1/email/messages
//   Authorization: Bearer <API_TOKEN>
//   body: { from_email, from_name?, to, subject, text?, html? }
// Документация: https://notisend.ru/dev/email/api/
const NOTISEND_ENDPOINT = "https://api.notisend.ru/v1/email/messages";

export function createNotisendMailer(): Mailer {
  const token = process.env.NOTISEND_API_KEY;
  const fromEmail = process.env.MAIL_FROM;
  const fromName = process.env.MAIL_FROM_NAME;

  if (!token || !fromEmail) {
    throw new Error(
      "MAILER=notisend требует переменные NOTISEND_API_KEY и MAIL_FROM",
    );
  }

  return {
    async sendCode(email, code) {
      const { subject, text, html } = codeEmailContent(code);

      const body = JSON.stringify({
          from_email: fromEmail,
          ...(fromName ? { from_name: fromName } : {}),
          to: email,
          subject,
          text,
          html,
        });

        console.log('---body', body);

      const res = await fetch(NOTISEND_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Notisend вернул ${res.status}: ${detail.slice(0, 300)}`,
        );
      }
    },
  };
}
