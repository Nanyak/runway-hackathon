import path from 'path';
import fs from 'fs/promises';
import https from 'https';
import http from 'http';
import { createWriteStream } from 'fs';
import logger from '../logger';
import { sessionsRoot } from './persistent-root';
import { s3PutFile, s3PutJson, s3GetJson, s3GetFile, isS3Enabled } from './storage';

const TEMP_ROOT = sessionsRoot();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toS3Key(localPath: string): string {
  const rel = path.relative(TEMP_ROOT, localPath);
  return `sessions/${rel}`;
}

/** Ensures a file is available locally, pulling from S3 if missing. Returns true if available. */
export async function ensureLocalFile(localPath: string): Promise<boolean> {
  try {
    await fs.access(localPath);
    return true;
  } catch {
    if (!isS3Enabled()) return false;
    return s3GetFile(toS3Key(localPath), localPath);
  }
}

/** Uploads a local file to S3 using its derived key. No-op if S3 is not configured. */
export async function syncLocalFileToS3(localPath: string): Promise<void> {
  await s3PutFile(toS3Key(localPath), localPath);
}

function assertSafeId(id: string, label: string): void {
  if (!UUID_RE.test(id)) {
    throw Object.assign(new Error(`Invalid ${label}: ${id}`), { status: 400 });
  }
}

function assertUnderRoot(resolved: string): void {
  if (!resolved.startsWith(TEMP_ROOT + path.sep) && resolved !== TEMP_ROOT) {
    throw Object.assign(new Error('Path traversal detected'), { status: 400 });
  }
}

export function sessionDir(sessionId: string): string {
  assertSafeId(sessionId, 'sessionId');
  const p = path.resolve(TEMP_ROOT, sessionId);
  assertUnderRoot(p);
  return p;
}

export function momentDir(sessionId: string, momentId: string): string {
  assertSafeId(sessionId, 'sessionId');
  assertSafeId(momentId, 'momentId');
  const p = path.resolve(TEMP_ROOT, sessionId, 'moments', momentId);
  assertUnderRoot(p);
  return p;
}

export function sessionFilePath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'session.json');
}

export function transcriptFilePath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'transcript.json');
}

export function momentsFilePath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'moments.json');
}

/** Podcast excerpt for one viral moment only (`extractMomentAudio` → startSec…endSec). Used for previews + Seedance `referenceAudio`. */
export function audioPath(sessionId: string, momentId: string): string {
  return path.join(momentDir(sessionId, momentId), 'audio.wav');
}

/** @deprecated use storyboardPath instead */
export function scenesFilePath(sessionId: string, momentId: string): string {
  return path.join(momentDir(sessionId, momentId), 'scenes.json');
}

/** @deprecated use momentImagePath instead */
export function sceneImagePath(sessionId: string, momentId: string, sceneIndex: number): string {
  return path.join(momentDir(sessionId, momentId), `scene_${sceneIndex}_bg.png`);
}

/** @deprecated use momentVideoPath instead */
export function sceneClipPath(sessionId: string, momentId: string, sceneIndex: number): string {
  return path.join(momentDir(sessionId, momentId), `scene_${sceneIndex}_clip.mp4`);
}

// ── Frame-variation paths (new pipeline) ───────────────────────────────────

/** JSON array of FrameVariation objects for one moment */
export function variationsPath(sessionId: string, momentId: string): string {
  return path.join(momentDir(sessionId, momentId), 'variations.json');
}

/** PNG image for one variation (index 0, 1, 2) */
export function variationImagePath(sessionId: string, momentId: string, index: number): string {
  return path.join(momentDir(sessionId, momentId), `variation_${index}.png`);
}

/** Raw image_to_video output — no captions, no audio */
export function momentVideoPath(sessionId: string, momentId: string): string {
  return path.join(momentDir(sessionId, momentId), 'video.mp4');
}

/** JSON StoryboardPlan for one moment (storyboard-based flow). */
export function storyboardPath(sessionId: string, momentId: string): string {
  return path.join(momentDir(sessionId, momentId), 'storyboard.json');
}

/** PNG image for one storyboard frame (index 0–8). */
export function storyboardFrameImagePath(sessionId: string, momentId: string, index: number): string {
  return path.join(momentDir(sessionId, momentId), `frame_${index}.png`);
}

/** GPT Image 2 character portrait extracted from a moment's storyboard sheet. */
export function characterRefImagePath(sessionId: string, momentId: string): string {
  return path.join(momentDir(sessionId, momentId), 'character_ref.png');
}

/** @deprecated use variationImagePath */
export function momentImagePath(sessionId: string, momentId: string): string {
  return path.join(momentDir(sessionId, momentId), 'bg.png');
}

export function composedPath(sessionId: string, momentId: string): string {
  return path.join(momentDir(sessionId, momentId), 'composed.mp4');
}

export function finalPath(sessionId: string, momentId: string): string {
  return path.join(momentDir(sessionId, momentId), 'final.mp4');
}

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

/** Removes the entire session directory (audio, checkpoints, outputs). */
export async function removeSessionDir(sessionId: string): Promise<void> {
  const dir = sessionDir(sessionId);
  await fs.rm(dir, { recursive: true, force: true });
}

export async function downloadFile(url: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  logger.info('Downloading file', { url: url.substring(0, 80), dest });

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = createWriteStream(dest);

    const request = protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        if (!redirectUrl) {
          reject(new Error('Redirect with no location header'));
          return;
        }
        file.close();
        downloadFile(redirectUrl, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => {
        fs.unlink(dest).catch(() => undefined);
        reject(err);
      });
    });

    request.on('error', (err) => {
      fs.unlink(dest).catch(() => undefined);
      reject(err);
    });

    request.setTimeout(120_000, () => {
      request.destroy();
      reject(new Error(`Download timeout for ${url}`));
    });
  });

  await s3PutFile(toS3Key(dest), dest);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
  await s3PutJson(toS3Key(filePath), data);
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return s3GetJson<T>(toS3Key(filePath));
  }
}

export function chunkDir(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'chunks');
}

export function revisionPath(sessionId: string, momentId: string, revisionId: string): string {
  return path.join(momentDir(sessionId, momentId), `revision_${revisionId}.mp4`);
}

export function revisionsMetaPath(sessionId: string, momentId: string): string {
  return path.join(momentDir(sessionId, momentId), 'revisions.json');
}
