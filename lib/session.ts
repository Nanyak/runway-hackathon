import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { Mutex } from 'async-mutex';
import { Session, SessionConfig, PipelineEvent } from './types';
import { sessionDir, sessionFilePath, ensureDir, atomicWriteJson, readJsonFile } from './utils/file-utils';
import logger from './logger';

// Per-session mutex — serializes all reads+writes to session.json
const sessionMutexes = new Map<string, Mutex>();
function getMutex(id: string): Mutex {
  if (!sessionMutexes.has(id)) sessionMutexes.set(id, new Mutex());
  return sessionMutexes.get(id)!;
}

export async function createSession(config: SessionConfig, audioPath: string, id?: string): Promise<Session> {
  id = id ?? uuidv4();
  const now = new Date().toISOString();

  const session: Session = {
    id,
    createdAt: now,
    status: 'uploading',
    config,
    audioPath,
    events: [],
  };

  const dir = sessionDir(id);
  await ensureDir(dir);
  await atomicWriteJson(sessionFilePath(id), session);

  logger.info('Session created', { sessionId: id });
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  const filePath = sessionFilePath(id);
  const session = await readJsonFile<Session>(filePath);
  if (!session) {
    logger.warn('Session not found', { sessionId: id });
    return null;
  }
  return session;
}

export async function updateSession(id: string, patch: Partial<Session>): Promise<Session> {
  const filePath = sessionFilePath(id);
  return getMutex(id).runExclusive(async () => {
    const session = await readJsonFile<Session>(filePath);
    if (!session) throw new Error(`Session ${id} not found`);
    const updated: Session = { ...session, ...patch, id };
    await atomicWriteJson(filePath, updated);
    logger.debug('Session updated', { sessionId: id, keys: Object.keys(patch) });
    return updated;
  });
}

export async function appendEvent(
  id: string,
  event: Omit<PipelineEvent, 'id'>
): Promise<void> {
  const filePath = sessionFilePath(id);
  await getMutex(id).runExclusive(async () => {
    const session = await readJsonFile<Session>(filePath);
    if (!session) {
      logger.error('Cannot append event — session not found', { sessionId: id });
      return;
    }
    const newEvent: PipelineEvent = { ...event, id: String(session.events.length) };
    const updated: Session = { ...session, events: [...session.events, newEvent] };
    await atomicWriteJson(filePath, updated);
    logger.debug('Event appended', { sessionId: id, type: event.type });
  });
}

export async function saveCheckpoint<T>(
  sessionId: string,
  key: string,
  data: T
): Promise<void> {
  const dir = sessionDir(sessionId);
  const filePath = path.join(dir, `checkpoint_${key}.json`);
  await atomicWriteJson(filePath, data);
  logger.debug('Checkpoint saved', { sessionId, key });
}

export async function loadCheckpoint<T>(
  sessionId: string,
  key: string
): Promise<T | null> {
  const dir = sessionDir(sessionId);
  const filePath = path.join(dir, `checkpoint_${key}.json`);
  const data = await readJsonFile<T>(filePath);
  if (data !== null) {
    logger.debug('Checkpoint loaded', { sessionId, key });
  }
  return data;
}
