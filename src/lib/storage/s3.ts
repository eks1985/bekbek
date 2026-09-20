import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Selectel Object Storage — S3-совместимое API. Ключи только в env
// (.env.local локально, переменные проекта на Layero в проде).
type S3Config = { client: S3Client; bucket: string };

let cached: S3Config | undefined;

function getS3(): S3Config {
  if (cached) return cached;

  const {
    S3_ENDPOINT,
    S3_REGION,
    S3_BUCKET,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
  } = process.env;
  if (
    !S3_ENDPOINT ||
    !S3_REGION ||
    !S3_BUCKET ||
    !S3_ACCESS_KEY_ID ||
    !S3_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      "Не заданы S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY",
    );
  }

  const client = new S3Client({
    // В панели Selectel адрес показан без схемы — добавляем https:// сами.
    endpoint: /^https?:\/\//.test(S3_ENDPOINT)
      ? S3_ENDPOINT
      : `https://${S3_ENDPOINT}`,
    region: S3_REGION,
    forcePathStyle: true, // Selectel: https://<endpoint>/<bucket>/<key>
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    },
  });

  cached = { client, bucket: S3_BUCKET };
  return cached;
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const { client, bucket } = getS3();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** Читает объект целиком в память: FIT-файлы маленькие (сотни КБ). */
export async function getObject(key: string): Promise<Uint8Array> {
  const { client, bucket } = getS3();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`Пустой ответ хранилища для ${key}`);
  return res.Body.transformToByteArray();
}

export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = getS3();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
