export interface Mailer {
  /** Отправляет письмо с кодом входа на указанный email. */
  sendCode(email: string, code: string): Promise<void>;
}

/** Тема и тело письма с кодом — общие для всех адаптеров. */
export function codeEmailContent(code: string) {
  return {
    subject: `Код для входа: ${code}`,
    text: `Ваш код для входа: ${code}\n\nКод действует 10 минут. Если вы не запрашивали вход — просто проигнорируйте это письмо.`,
    html: `<p>Ваш код для входа:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>Код действует 10 минут. Если вы не запрашивали вход — просто проигнорируйте это письмо.</p>`,
  };
}
