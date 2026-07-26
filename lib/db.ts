import { env } from "cloudflare:workers";
import type { LearningProfile } from "./types";

const DEFAULT_PROFILE: LearningProfile = {
  direction: "Agent 产品与交互设计",
  level: "进阶入门",
  project: "先鉴：帮助学习者判断会议值不值得看，并生成时间码路线",
  knownTopics: "Prompt 基础、RAG 基础、用户研究",
  preferences: "优先真实案例；减少概念复述；保留反对观点；自动识别推广内容",
};

let schemaReady: Promise<void> | null = null;

function binding(): D1Database {
  if (!env.DB) throw new Error("D1 数据库尚未配置");
  return env.DB;
}

export async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = binding();
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS profiles (
        session_id TEXT PRIMARY KEY,
        direction TEXT NOT NULL,
        level TEXT NOT NULL,
        project TEXT NOT NULL,
        known_topics TEXT NOT NULL,
        preferences TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        transcript TEXT NOT NULL,
        transcript_hash TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'archived',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        conn_id TEXT NOT NULL,
        task_id TEXT,
        input_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        progress_text TEXT NOT NULL DEFAULT '准备分析',
        result_json TEXT,
        raw_messages_json TEXT,
        workspace_json TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        segment_id TEXT,
        timecode_seconds INTEGER,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        analysis_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS meetings_session_idx ON meetings(session_id, created_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS analyses_session_idx ON analyses(session_id, created_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS analyses_input_idx ON analyses(session_id, input_hash)"),
      db.prepare("CREATE INDEX IF NOT EXISTS notes_session_idx ON notes(session_id, created_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS knowledge_session_idx ON knowledge_items(session_id, created_at DESC)"),
    ]);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

export function getD1() {
  return binding();
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function getSession(request: Request) {
  await ensureSchema();
  const existing = cookieValue(request, "xianjian_session");
  const sessionId = existing || crypto.randomUUID();
  const db = binding();
  await db
    .prepare("INSERT OR IGNORE INTO sessions (id) VALUES (?)")
    .bind(sessionId)
    .run();
  await db
    .prepare("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(sessionId)
    .run();

  const profile = await db
    .prepare("SELECT session_id FROM profiles WHERE session_id = ?")
    .bind(sessionId)
    .first();
  if (!profile) {
    await db
      .prepare(`INSERT INTO profiles
        (session_id, direction, level, project, known_topics, preferences)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        sessionId,
        DEFAULT_PROFILE.direction,
        DEFAULT_PROFILE.level,
        DEFAULT_PROFILE.project,
        DEFAULT_PROFILE.knownTopics,
        DEFAULT_PROFILE.preferences
      )
      .run();
  }

  return {
    sessionId,
    cookie: existing
      ? null
      : `xianjian_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
  };
}

export function json(data: unknown, init: ResponseInit = {}, cookie?: string | null) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseTimecodeDuration(transcript: string) {
  const matches = [...transcript.matchAll(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?/g)];
  let max = 0;
  for (const match of matches) {
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    max = Math.max(max, hours * 3600 + minutes * 60 + seconds);
  }
  return max;
}

export function defaultProfile() {
  return { ...DEFAULT_PROFILE };
}
