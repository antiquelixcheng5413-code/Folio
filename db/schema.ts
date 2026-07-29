import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const profiles = sqliteTable("profiles", {
  sessionId: text("session_id").primaryKey(),
  direction: text("direction").notNull(),
  level: text("level").notNull(),
  project: text("project").notNull(),
  knownTopics: text("known_topics").notNull(),
  preferences: text("preferences").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workspaceSettings = sqliteTable("workspace_settings", {
  sessionId: text("session_id").primaryKey(),
  autoCreateNote: integer("auto_create_note").notNull().default(1),
  autoDiscoverVideos: integer("auto_discover_videos").notNull().default(0),
  autoAnalyzeDiscoveries: integer("auto_analyze_discoveries").notNull().default(0),
  titleMode: text("title_mode").notNull().default("automatic"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const meetings = sqliteTable("meetings", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  title: text("title").notNull(),
  source: text("source").notNull(),
  contentType: text("content_type").notNull().default("video"),
  videoUrl: text("video_url"),
  titleIsManual: integer("title_is_manual").notNull().default(0),
  transcript: text("transcript").notNull(),
  transcriptHash: text("transcript_hash").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  state: text("state").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const analyses = sqliteTable("analyses", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  meetingId: text("meeting_id").notNull(),
  connId: text("conn_id").notNull(),
  taskId: text("task_id"),
  inputHash: text("input_hash").notNull(),
  status: text("status").notNull(),
  progressText: text("progress_text").notNull().default("准备分析"),
  resultJson: text("result_json"),
  rawMessagesJson: text("raw_messages_json"),
  workspaceJson: text("workspace_json"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  meetingId: text("meeting_id").notNull(),
  segmentId: text("segment_id"),
  timecodeSeconds: integer("timecode_seconds"),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeItems = sqliteTable("knowledge_items", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  meetingId: text("meeting_id").notNull(),
  analysisId: text("analysis_id").notNull(),
  topic: text("topic").notNull(),
  status: text("status").notNull(),
  evidence: text("evidence").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const discoveryCandidates = sqliteTable("discovery_candidates", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  keyword: text("keyword").notNull(),
  title: text("title").notNull(),
  videoUrl: text("video_url").notNull(),
  source: text("source").notNull(),
  snippet: text("snippet").notNull().default(""),
  status: text("status").notNull().default("recommended"),
  meetingId: text("meeting_id"),
  analysisId: text("analysis_id"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const authUsers = sqliteTable("auth_users", {
  infiniUserId: text("infini_user_id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  email: text("email"),
  username: text("username"),
  nickname: text("nickname"),
  avatar: text("avatar"),
  phone: text("phone"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const analysisTranslations = sqliteTable("analysis_translations", {
  analysisId: text("analysis_id").notNull(),
  sessionId: text("session_id").notNull(),
  language: text("language").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
