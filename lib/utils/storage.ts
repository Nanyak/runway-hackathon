import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import logger from '../logger';

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      endpoint: process.env.AWS_ENDPOINT_URL,
      region: process.env.AWS_REGION ?? 'auto',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
      forcePathStyle: true,
    });
  }
  return _client;
}

const bucket = (): string => process.env.AWS_BUCKET ?? '';

export function isS3Enabled(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_BUCKET
  );
}

export async function s3PutFile(key: string, localPath: string): Promise<void> {
  if (!isS3Enabled()) return;
  try {
    const body = await fs.readFile(localPath);
    await getClient().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body }));
    logger.debug('S3 put', { key });
  } catch (err) {
    logger.warn('S3 put failed', { key, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function s3PutJson(key: string, data: unknown): Promise<void> {
  if (!isS3Enabled()) return;
  try {
    const body = JSON.stringify(data, null, 2);
    await getClient().send(new PutObjectCommand({
      Bucket: bucket(), Key: key, Body: body, ContentType: 'application/json',
    }));
    logger.debug('S3 put JSON', { key });
  } catch (err) {
    logger.warn('S3 put JSON failed', { key, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function s3GetJson<T>(key: string): Promise<T | null> {
  if (!isS3Enabled()) return null;
  try {
    const result = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const body = await result.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

export async function s3GetFile(key: string, localPath: string): Promise<boolean> {
  if (!isS3Enabled()) return false;
  try {
    const result = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    if (!result.Body) return false;
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const writer = createWriteStream(localPath);
      (result.Body as Readable).pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    logger.debug('S3 get file', { key });
    return true;
  } catch {
    return false;
  }
}

export async function s3Exists(key: string): Promise<boolean> {
  if (!isS3Enabled()) return false;
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}
