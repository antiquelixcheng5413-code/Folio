import { env } from "cloudflare:workers";
import type { LearningProfile } from "./types";

const DEFAULT_PROFILE: LearningProfile = {
  direction: "",
  level: "",
  project: "",
  knownTopics: "",
  preferences: "",
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
      db.prepare(`CREATE TABLE IF NOT EXISTS workspace_settings (
        session_id TEXT PRIMARY KEY,
        auto_create_note INTEGER NOT NULL DEFAULT 1,
        auto_discover_videos INTEGER NOT NULL DEFAULT 0,
        auto_analyze_discoveries INTEGER NOT NULL DEFAULT 0,
        title_mode TEXT NOT NULL DEFAULT 'automatic',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'video',
        video_url TEXT,
        title_is_manual INTEGER NOT NULL DEFAULT 0,
        transcript TEXT NOT NULL,
        transcript_hash TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'pending',
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
      db.prepare(`CREATE TABLE IF NOT EXISTS discovery_candidates (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        keyword TEXT NOT NULL,
        title TEXT NOT NULL,
        video_url TEXT NOT NULL,
        source TEXT NOT NULL,
        snippet TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'recommended',
        meeting_id TEXT,
        analysis_id TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS auth_users (
        infini_user_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        email TEXT,
        username TEXT,
        nickname TEXT,
        avatar TEXT,
        phone TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS meetings_session_idx ON meetings(session_id, created_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS analyses_session_idx ON analyses(session_id, created_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS analyses_input_idx ON analyses(session_id, input_hash)"),
      db.prepare("CREATE INDEX IF NOT EXISTS notes_session_idx ON notes(session_id, created_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS knowledge_session_idx ON knowledge_items(session_id, created_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS discovery_session_idx ON discovery_candidates(session_id, created_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS auth_users_session_idx ON auth_users(session_id)"),
    ]);
    try {
      await db.prepare("ALTER TABLE meetings ADD COLUMN video_url TEXT").run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
    try {
      await db.prepare("ALTER TABLE meetings ADD COLUMN content_type TEXT NOT NULL DEFAULT 'video'").run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
    try {
      await db.prepare("ALTER TABLE meetings ADD COLUMN title_is_manual INTEGER NOT NULL DEFAULT 0").run();
      // Existing titles may have been entered by the user, so migration must preserve them.
      await db.prepare("UPDATE meetings SET title_is_manual = 1").run();
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
    for (const statement of [
      "ALTER TABLE workspace_settings ADD COLUMN auto_discover_videos INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE workspace_settings ADD COLUMN auto_analyze_discoveries INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE workspace_settings ADD COLUMN title_mode TEXT NOT NULL DEFAULT 'automatic'",
    ]) {
      try {
        await db.prepare(statement).run();
      } catch (error) {
        if (!String(error).toLowerCase().includes("duplicate column")) throw error;
      }
    }
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

export function getD1() {
  return binding();
}

export function cookieValue(request: Request, name: string) {
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
  await db
    .prepare(`INSERT OR IGNORE INTO workspace_settings (session_id, auto_create_note)
      VALUES (?, 1)`)
    .bind(sessionId)
    .run();

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

export type WorkspaceSettings = {
  autoCreateNote: boolean;
  autoDiscoverVideos: boolean;
  autoAnalyzeDiscoveries: boolean;
  titleMode: "automatic" | "source";
};

export async function getWorkspaceSettings(sessionId: string): Promise<WorkspaceSettings> {
  const row = await getD1()
    .prepare(`SELECT auto_create_note AS autoCreateNote,
      auto_discover_videos AS autoDiscoverVideos,
      auto_analyze_discoveries AS autoAnalyzeDiscoveries,
      title_mode AS titleMode
      FROM workspace_settings WHERE session_id = ?`)
    .bind(sessionId)
    .first<{ autoCreateNote: number; autoDiscoverVideos: number; autoAnalyzeDiscoveries: number; titleMode: string }>();
  return {
    autoCreateNote: Number(row?.autoCreateNote ?? 1) === 1,
    autoDiscoverVideos: Number(row?.autoDiscoverVideos ?? 0) === 1,
    autoAnalyzeDiscoveries: Number(row?.autoAnalyzeDiscoveries ?? 0) === 1,
    titleMode: row?.titleMode === "source" ? "source" : "automatic",
  };
}
