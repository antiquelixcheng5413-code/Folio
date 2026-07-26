CREATE TABLE `analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`meeting_id` text NOT NULL,
	`conn_id` text NOT NULL,
	`task_id` text,
	`input_hash` text NOT NULL,
	`status` text NOT NULL,
	`progress_text` text DEFAULT '准备分析' NOT NULL,
	`result_json` text,
	`raw_messages_json` text,
	`workspace_json` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge_items` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`meeting_id` text NOT NULL,
	`analysis_id` text NOT NULL,
	`topic` text NOT NULL,
	`status` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`transcript` text NOT NULL,
	`transcript_hash` text NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'archived' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`meeting_id` text NOT NULL,
	`segment_id` text,
	`timecode_seconds` integer,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`session_id` text PRIMARY KEY NOT NULL,
	`direction` text NOT NULL,
	`level` text NOT NULL,
	`project` text NOT NULL,
	`known_topics` text NOT NULL,
	`preferences` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
