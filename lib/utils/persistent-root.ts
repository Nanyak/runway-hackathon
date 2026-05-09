import path from 'path';

/**
 * Writable data root: SQLite, uploads, logs under `temp/`.
 * On Railway, add a volume and set `PERSISTENT_DATA_ROOT` to its mount path (e.g. `/data`).
 * If unset, uses `process.cwd()` (local dev).
 */
export function persistentDataRoot(): string {
  const fromEnv = process.env.PERSISTENT_DATA_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd());
}

export function sessionsRoot(): string {
  return path.join(persistentDataRoot(), 'temp', 'sessions');
}

export function dbDirPath(): string {
  return path.join(persistentDataRoot(), 'data');
}
