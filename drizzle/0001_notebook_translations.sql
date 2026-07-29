CREATE TABLE `notebook_translations` (
  `cache_key` text PRIMARY KEY NOT NULL,
  `meeting_id` text NOT NULL,
  `session_id` text NOT NULL,
  `language` text NOT NULL,
  `source_hash` text NOT NULL,
  `content_json` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notebook_translations_session_idx`
  ON `notebook_translations` (`session_id`, `meeting_id`);
