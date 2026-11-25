CREATE TABLE `ai_calls` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`purpose` varchar(24) NOT NULL,
	`conversation_id` bigint unsigned,
	`user_id` bigint unsigned,
	`provider` varchar(16) NOT NULL,
	`model` varchar(64) NOT NULL,
	`ok` boolean NOT NULL,
	`error` varchar(500),
	`input_tokens` int NOT NULL DEFAULT 0,
	`output_tokens` int NOT NULL DEFAULT 0,
	`cost_micro_usd` bigint NOT NULL DEFAULT 0,
	`duration_ms` int NOT NULL DEFAULT 0,
	`meta` json,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `ai_calls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`thread_id` bigint unsigned NOT NULL,
	`kind` enum('offer','user','answer','error') NOT NULL,
	`status` enum('pending','running','done','error','cancelled') NOT NULL DEFAULT 'done',
	`text` mediumtext,
	`data` json,
	`offer_state` enum('open','answered','dismissed'),
	`trigger_message_id` bigint unsigned,
	`created_by_user_id` bigint unsigned,
	`provider` varchar(16),
	`model` varchar(64),
	`duration_ms` int,
	`error` text,
	`feedback` int,
	`feedback_by` bigint unsigned,
	`used_at` datetime(3),
	`used_by` bigint unsigned,
	`saved_document_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL,
	`completed_at` datetime(3),
	CONSTRAINT `ai_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_threads` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`conversation_id` bigint unsigned NOT NULL,
	`topic_started_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `ai_threads_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_threads_conversation_id_unique` UNIQUE(`conversation_id`)
);
--> statement-breakpoint
CREATE TABLE `kb_chunks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`document_id` bigint unsigned NOT NULL,
	`seq` int NOT NULL,
	`page` int,
	`heading` varchar(255),
	`text` mediumtext NOT NULL,
	CONSTRAINT `kb_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kb_documents` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`kind` enum('file','note') NOT NULL DEFAULT 'file',
	`title` varchar(190) NOT NULL,
	`description` varchar(500),
	`tags` json NOT NULL,
	`file_name` varchar(255),
	`mime_type` varchar(128),
	`file_size` bigint unsigned,
	`sha256` char(64),
	`storage_path` varchar(500),
	`status` enum('processing','ready','failed') NOT NULL DEFAULT 'processing',
	`error` text,
	`page_count` int,
	`char_count` int,
	`summary` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`is_official` boolean NOT NULL DEFAULT false,
	`valid_until` varchar(10),
	`uploaded_by` bigint unsigned,
	`deleted_at` datetime(3),
	`deleted_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `kb_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD `aos_offer_message_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_thread_id_ai_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `ai_threads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_threads` ADD CONSTRAINT `ai_threads_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `kb_chunks` ADD CONSTRAINT `kb_chunks_document_id_kb_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `kb_documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_calls_created_idx` ON `ai_calls` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_thread_idx` ON `ai_messages` (`thread_id`,`id`);--> statement-breakpoint
CREATE INDEX `kb_chunks_document_idx` ON `kb_chunks` (`document_id`,`seq`);--> statement-breakpoint
CREATE INDEX `kb_documents_sha_idx` ON `kb_documents` (`sha256`);--> statement-breakpoint
CREATE INDEX `kb_documents_deleted_idx` ON `kb_documents` (`deleted_at`);--> statement-breakpoint
-- Pencarian isi Pustaka (alat cari_pustaka AOS dan halaman Pustaka).
CREATE FULLTEXT INDEX `kb_chunks_text_ft` ON `kb_chunks` (`text`);
