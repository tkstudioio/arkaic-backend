import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY;
const _bucket = process.env.MINIO_BUCKET;

if (!MINIO_ENDPOINT || !_bucket || !MINIO_SECRET_KEY || !MINIO_ACCESS_KEY)
  throw new Error("Missing MINIO configuration");

export const MINIO_BUCKET: string = _bucket;

export const s3 = new S3Client({
  endpoint: MINIO_ENDPOINT,
  region: "us-east-1",
  credentials: {
    accessKeyId: MINIO_ACCESS_KEY,
    secretAccessKey: MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

export async function uploadObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
    }),
  );
}

export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: MINIO_BUCKET,
      Key: key,
    }),
    { expiresIn },
  );
}

export async function getPresignedUrls(
  keys: string[],
  expiresIn = 3600,
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    keys.map(async (key) => [key, await getPresignedUrl(key, expiresIn)] as const),
  );
  return new Map(entries);
}
