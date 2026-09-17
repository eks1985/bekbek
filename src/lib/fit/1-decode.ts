// Шаг 1. Байты файла → сообщения FIT.
//
// Как устроен FIT внутри (разбор делает официальный SDK Garmin):
//   [заголовок 14 байт: размер, версия протокола/профиля, ".FIT"]
//   [запись-определение: «сообщение №20 (record) = поля timestamp:4 байта, heart_rate:1 байт…»]
//   [запись с данными по этому определению] [ещё данные] … [новое определение] …
//   [CRC 2 байта]
// SDK собирает записи в массивы по типам: sessionMesgs, lapMesgs, recordMesgs и т.д.

import { Decoder, Stream, type FitMessages } from "@garmin/fitsdk";

export class FitParseError extends Error {}

export interface DecodedFit {
  messages: FitMessages;
  /** Версия профиля FIT из заголовка, например "21.184". */
  profileVersion: string;
}

export function decodeFit(bytes: Uint8Array): DecodedFit {
  const decoder = new Decoder(Stream.fromByteArray(bytes));

  if (!decoder.isFIT()) {
    throw new FitParseError("Это не FIT-файл: в заголовке нет сигнатуры .FIT");
  }
  if (!decoder.checkIntegrity()) {
    throw new FitParseError("FIT-файл повреждён: не сходится контрольная сумма (CRC)");
  }

  const { messages, profileVersion, errors } = decoder.read({
    applyScaleAndOffset: true, // сырые целые → реальные единицы (мм → м, 1/1000 с → с)
    expandComponents: true, // enhancedSpeed/enhancedAltitude из составных полей
    expandSubFields: true,
    convertTypesToStrings: true, // sport: 1 → "running"
    convertDateTimesToDates: true, // секунды от эпохи FIT (1989-12-31) → Date
    mergeHeartRates: true, // пульс с нагрудного датчика в режиме записи HR → в record
  });

  if (errors.length > 0) {
    const details = errors.map((e) => e.message).join("; ");
    throw new FitParseError(`Ошибка чтения FIT: ${details}`);
  }

  return {
    messages,
    profileVersion: `${profileVersion.major}.${profileVersion.minor}`,
  };
}
