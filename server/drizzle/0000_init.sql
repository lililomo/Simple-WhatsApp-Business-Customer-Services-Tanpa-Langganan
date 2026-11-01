CREATE TABLE `api_keys` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`prefix` char(12) NOT NULL,
	`key_hash` char(64) NOT NULL,
	`scopes` json NOT NULL,
	`created_by` bigint unsigned,
	`last_used_at` datetime(3),
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_key_hash_unique` UNIQUE(`key_hash`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor_user_id` bigint unsigned,
	`actor_api_key_id` bigint unsigned,
	`action` varchar(64) NOT NULL,
	`target_type` varchar(64),
	`target_id` varchar(64),
	`meta` json,
	`ip` varchar(64),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`wa_id` varchar(32) NOT NULL,
	`profile_name` varchar(190),
	`display_name` varchar(190),
	`raw` json,
	`first_seen_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `contacts_wa_id_unique` UNIQUE(`wa_id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`wa_account_id` bigint unsigned NOT NULL,
	`contact_id` bigint unsigned NOT NULL,
	`last_message_id` bigint unsigned,
	`last_message_at` datetime(3),
	`last_message_preview` varchar(200),
	`last_message_direction` enum('in','out'),
	`last_inbound_at` datetime(3),
	`csw_expires_at` datetime(3),
	`unread_count` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `conversations_account_contact_uq` UNIQUE(`wa_account_id`,`contact_id`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`api_key_id` bigint unsigned NOT NULL,
	`idem_key` varchar(128) NOT NULL,
	`request_hash` char(64) NOT NULL,
	`response_status` int NOT NULL,
	`response` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `idempotency_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `idempotency_key_uq` UNIQUE(`api_key_id`,`idem_key`)
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`wa_media_id` varchar(128),
	`direction` enum('in','out') NOT NULL,
	`mime_type` varchar(128),
	`file_name` varchar(255),
	`file_size` bigint unsigned,
	`sha256` char(64),
	`storage_path` varchar(500),
	`status` enum('pending','ready','failed','expired') NOT NULL DEFAULT 'pending',
	`error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`conversation_id` bigint unsigned NOT NULL,
	`wamid` varchar(128),
	`direction` enum('in','out') NOT NULL,
	`type` varchar(32) NOT NULL,
	`status` enum('pending','accepted','sent','delivered','read','failed','received') NOT NULL,
	`text` mediumtext,
	`payload` json,
	`media_id` bigint unsigned,
	`reply_to_wamid` varchar(128),
	`reaction_emoji` varchar(16),
	`template_name` varchar(190),
	`template_language` varchar(16),
	`sent_by_user_id` bigint unsigned,
	`sent_by_api_key_id` bigint unsigned,
	`client_ref` varchar(64),
	`error_code` int,
	`error_title` varchar(255),
	`error_detail` text,
	`pricing_category` varchar(32),
	`pricing_billable` boolean,
	`wa_timestamp` datetime(3),
	`sent_at` datetime(3),
	`delivered_at` datetime(3),
	`read_at` datetime(3),
	`failed_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `messages_wamid_unique` UNIQUE(`wamid`)
);
--> statement-breakpoint
CREATE TABLE `outbound_webhook_deliveries` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`webhook_id` bigint unsigned NOT NULL,
	`event_id` char(26) NOT NULL,
	`event_type` varchar(64) NOT NULL,
	`payload` longtext NOT NULL,
	`status` enum('pending','success','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` datetime(3) NOT NULL,
	`response_code` int,
	`response_snippet` varchar(500),
	`created_at` datetime(3) NOT NULL,
	`delivered_at` datetime(3),
	CONSTRAINT `outbound_webhook_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `outbound_webhooks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`url` varchar(500) NOT NULL,
	`secret_enc` text NOT NULL,
	`events` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`failure_count` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `outbound_webhooks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`ip` varchar(64),
	`user_agent` varchar(255),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`wa_account_id` bigint unsigned NOT NULL,
	`meta_template_id` varchar(64),
	`name` varchar(190) NOT NULL,
	`language` varchar(16) NOT NULL,
	`category` varchar(32) NOT NULL,
	`status` varchar(32) NOT NULL,
	`components` json NOT NULL,
	`quality_score` varchar(32),
	`rejected_reason` varchar(255),
	`synced_at` datetime(3) NOT NULL,
	CONSTRAINT `templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `templates_account_name_lang_uq` UNIQUE(`wa_account_id`,`name`,`language`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`email` varchar(190) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`role` enum('admin','agent') NOT NULL DEFAULT 'agent',
	`is_active` boolean NOT NULL DEFAULT true,
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `wa_accounts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`label` varchar(120) NOT NULL,
	`app_id` varchar(64) NOT NULL,
	`app_secret_enc` text NOT NULL,
	`waba_id` varchar(64) NOT NULL,
	`phone_number_id` varchar(64) NOT NULL,
	`display_phone_number` varchar(32),
	`verified_name` varchar(190),
	`quality_rating` varchar(16),
	`messaging_limit` varchar(32),
	`access_token_enc` text NOT NULL,
	`token_last4` char(4) NOT NULL,
	`verify_token` char(32) NOT NULL,
	`status` enum('active','error','disabled') NOT NULL DEFAULT 'active',
	`last_error` text,
	`last_webhook_at` datetime(3),
	`subscribed_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `wa_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `wa_accounts_phone_number_id_unique` UNIQUE(`phone_number_id`),
	CONSTRAINT `wa_accounts_verify_token_unique` UNIQUE(`verify_token`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`received_at` datetime(3) NOT NULL,
	`payload` longtext NOT NULL,
	`status` enum('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`lease_until` datetime(3),
	`next_attempt_at` datetime(3) NOT NULL,
	`error` text,
	`processed_at` datetime(3),
	CONSTRAINT `webhook_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_wa_account_id_wa_accounts_id_fk` FOREIGN KEY (`wa_account_id`) REFERENCES `wa_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_api_key_id_api_keys_id_fk` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversation_id_conversations_id_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outbound_webhook_deliveries` ADD CONSTRAINT `outbound_webhook_deliveries_webhook_id_outbound_webhooks_id_fk` FOREIGN KEY (`webhook_id`) REFERENCES `outbound_webhooks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `templates` ADD CONSTRAINT `templates_wa_account_id_wa_accounts_id_fk` FOREIGN KEY (`wa_account_id`) REFERENCES `wa_accounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `conversations_last_message_idx` ON `conversations` (`wa_account_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `media_wa_media_idx` ON `media` (`wa_media_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`id`);--> statement-breakpoint
CREATE INDEX `messages_client_ref_idx` ON `messages` (`client_ref`);--> statement-breakpoint
CREATE INDEX `deliveries_status_idx` ON `outbound_webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `webhook_events_status_idx` ON `webhook_events` (`status`,`next_attempt_at`);