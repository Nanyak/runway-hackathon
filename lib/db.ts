import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    _pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 10,
    });
  }
  return _pool;
}

let _initPromise: Promise<void> | null = null;

async function initDb(): Promise<void> {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_file_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled podcast',
      status TEXT NOT NULL DEFAULT 'uploading',
      speaker_name TEXT NOT NULL DEFAULT '',
      show_name TEXT NOT NULL DEFAULT '',
      display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_status ON user_sessions(status)`);

  await seedDemoUser(pool);
  logger.info('Database initialised (PostgreSQL)');
}

function ensureInit(): Promise<void> {
  if (!_initPromise) {
    _initPromise = initDb().catch((err) => {
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

async function seedDemoUser(pool: Pool): Promise<void> {
  const result = await pool.query('SELECT id FROM users WHERE email = $1', ['demo@example.com']);
  if (result.rows.length === 0) {
    const hash = await bcrypt.hash('password123', 10);
    await pool.query(
      'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
      [uuidv4(), 'demo@example.com', 'Demo User', hash]
    );
    logger.info('Demo user seeded');
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DbUser {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
}

export interface DbSession {
  id: string;
  user_id: string;
  session_file_id: string;
  title: string;
  display_name?: string | null;
  status: string;
  speaker_name: string;
  show_name: string;
  created_at: string;
  updated_at: string;
}

// ── User helpers ──────────────────────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  await ensureInit();
  const result = await getPool().query('SELECT * FROM users WHERE email = $1', [email]);
  return (result.rows[0] as DbUser) ?? null;
}

export async function findUserById(id: string): Promise<DbUser | null> {
  await ensureInit();
  const result = await getPool().query('SELECT * FROM users WHERE id = $1', [id]);
  return (result.rows[0] as DbUser) ?? null;
}

export async function createUser(email: string, name: string, password: string): Promise<DbUser> {
  await ensureInit();
  const existing = await findUserByEmail(email);
  if (existing) throw new Error('Email already registered');

  const id = uuidv4();
  const password_hash = await bcrypt.hash(password, 10);
  await getPool().query(
    'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
    [id, email, name, password_hash]
  );
  const created = await findUserById(id);
  if (!created) throw new Error('User creation failed unexpectedly');
  return created;
}

// ── Session record helpers ────────────────────────────────────────────────────

export async function createSessionRecord(
  userId: string,
  sessionFileId: string,
  opts: { title?: string; speakerName?: string; showName?: string } = {}
): Promise<DbSession> {
  await ensureInit();
  const id = uuidv4();
  const title = opts.title ?? 'Untitled podcast';
  const speakerName = opts.speakerName ?? '';
  const showName = opts.showName ?? '';

  await getPool().query(
    `INSERT INTO user_sessions (id, user_id, session_file_id, title, speaker_name, show_name)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, sessionFileId, title, speakerName, showName]
  );

  const created = await getSessionRecord(id);
  if (!created) throw new Error('Session record creation failed unexpectedly');
  return created;
}

export async function getSessionRecord(id: string): Promise<DbSession | null> {
  await ensureInit();
  const result = await getPool().query('SELECT * FROM user_sessions WHERE id = $1', [id]);
  return (result.rows[0] as DbSession) ?? null;
}

export async function getSessionRecordByFileId(sessionFileId: string): Promise<DbSession | null> {
  await ensureInit();
  const result = await getPool().query(
    'SELECT * FROM user_sessions WHERE session_file_id = $1',
    [sessionFileId]
  );
  return (result.rows[0] as DbSession) ?? null;
}

export async function listUserSessions(userId: string): Promise<DbSession[]> {
  await ensureInit();
  const result = await getPool().query(
    'SELECT * FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows as DbSession[];
}

export function formatSessionListLabel(s: DbSession): string {
  const custom = s.display_name?.trim();
  if (custom) return custom;
  if (s.show_name) {
    return `${s.show_name}${s.speaker_name ? ` · ${s.speaker_name}` : ''}`;
  }
  return s.speaker_name || s.title;
}

export async function updateSessionDisplayName(
  userId: string,
  sessionFileId: string,
  displayName: string
): Promise<boolean> {
  await ensureInit();
  const result = await getPool().query(
    `UPDATE user_sessions SET display_name = $1, updated_at = NOW()
     WHERE session_file_id = $2 AND user_id = $3`,
    [displayName, sessionFileId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteUserSessionByFileId(userId: string, sessionFileId: string): Promise<boolean> {
  await ensureInit();
  const result = await getPool().query(
    `DELETE FROM user_sessions WHERE session_file_id = $1 AND user_id = $2`,
    [sessionFileId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateSessionStatus(sessionFileId: string, status: string): Promise<void> {
  await ensureInit();
  await getPool().query(
    `UPDATE user_sessions SET status = $1, updated_at = NOW() WHERE session_file_id = $2`,
    [status, sessionFileId]
  );
}
