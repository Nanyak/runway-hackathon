import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';
import { dbDirPath } from './utils/persistent-root';

const DB_DIR = dbDirPath();
const DB_PATH = path.join(DB_DIR, 'app.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_file_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled podcast',
      status TEXT NOT NULL DEFAULT 'uploading',
      speaker_name TEXT NOT NULL DEFAULT '',
      show_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_status ON user_sessions(status);
  `);

  seedDemoUser(_db);
  logger.info('Database initialised', { path: DB_PATH });
  return _db;
}

function seedDemoUser(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@example.com');
  if (!existing) {
    const hash = bcrypt.hashSync('password123', 10);
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      uuidv4(),
      'demo@example.com',
      'Demo User',
      hash
    );
    logger.info('Demo user seeded');
  }
}

// ── User helpers ────────────────────────────────────────────────────────────

export interface DbUser {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
}

export function findUserByEmail(email: string): DbUser | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM users WHERE email = ?').get(email) as DbUser) ?? null;
}

export function findUserById(id: string): DbUser | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser) ?? null;
}

export function createUser(email: string, name: string, password: string): DbUser {
  const db = getDb();
  const existing = findUserByEmail(email);
  if (existing) throw new Error('Email already registered');

  const id = uuidv4();
  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    id, email, name, password_hash
  );
  const created = findUserById(id);
  if (!created) throw new Error('User creation failed unexpectedly');
  return created;
}

// ── Session record helpers ───────────────────────────────────────────────────

export interface DbSession {
  id: string;
  user_id: string;
  session_file_id: string;
  title: string;
  status: string;
  speaker_name: string;
  show_name: string;
  created_at: string;
  updated_at: string;
}

export function createSessionRecord(
  userId: string,
  sessionFileId: string,
  opts: { title?: string; speakerName?: string; showName?: string } = {}
): DbSession {
  const db = getDb();
  const id = uuidv4();
  const title = opts.title ?? 'Untitled podcast';
  const speakerName = opts.speakerName ?? '';
  const showName = opts.showName ?? '';

  db.prepare(`
    INSERT INTO user_sessions (id, user_id, session_file_id, title, speaker_name, show_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, sessionFileId, title, speakerName, showName);

  const created = getSessionRecord(id);
  if (!created) throw new Error('Session record creation failed unexpectedly');
  return created;
}

export function getSessionRecord(id: string): DbSession | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM user_sessions WHERE id = ?').get(id) as DbSession) ?? null;
}

export function getSessionRecordByFileId(sessionFileId: string): DbSession | null {
  const db = getDb();
  return (
    (db.prepare('SELECT * FROM user_sessions WHERE session_file_id = ?').get(sessionFileId) as DbSession) ?? null
  );
}

export function listUserSessions(userId: string): DbSession[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as DbSession[];
}

export function updateSessionStatus(sessionFileId: string, status: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE user_sessions SET status = ?, updated_at = datetime('now') WHERE session_file_id = ?
  `).run(status, sessionFileId);
}
