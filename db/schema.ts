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

export const meetings = sqliteTable("meetings", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  title: text("title").notNull(),
  source: text("source").notNull(),
  transcript: text("transcript").notNull(),
  transcriptHash: text("transcript_hash").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  state: text("state").notNull().default("archived"),
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
