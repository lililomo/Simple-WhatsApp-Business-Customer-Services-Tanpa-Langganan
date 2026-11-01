CREATE TABLE `app_settings` (
	`key` varchar(64) NOT NULL,
	`value` json NOT NULL,
	`updated_by` bigint unsigned,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `app_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `auto_reply_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`contact_id` bigint unsigned NOT NULL,
	`day` varchar(10) NOT NULL,
	`message_id` bigint unsigned,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `auto_reply_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emoji_usage` (
	`code` varchar(64) NOT NULL,
	`usage_count` int NOT NULL DEFAULT 0,
	`last_used_at` datetime(3) NOT NULL,
	CONSTRAINT `emoji_usage_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `holidays` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`name` varchar(190) NOT NULL,
	`type` varchar(32) NOT NULL,
	`fetched_at` datetime(3) NOT NULL,
	CONSTRAINT `holidays_id` PRIMARY KEY(`id`),
	CONSTRAINT `holidays_date_name_uq` UNIQUE(`date`,`name`)
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`session_id` bigint unsigned NOT NULL,
	`endpoint_hash` char(64) NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` varchar(255) NOT NULL,
	`auth` varchar(255) NOT NULL,
	`user_agent` varchar(255),
	`last_success_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_subscriptions_endpoint_hash_unique` UNIQUE(`endpoint_hash`)
);
--> statement-breakpoint
CREATE TABLE `quick_replies` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`title` varchar(100) NOT NULL,
	`shortcut` varchar(40),
	`body` text NOT NULL,
	`usage_count` int NOT NULL DEFAULT 0,
	`last_used_at` datetime(3),
	`created_by` bigint unsigned,
	`updated_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `quick_replies_id` PRIMARY KEY(`id`),
	CONSTRAINT `quick_replies_shortcut_unique` UNIQUE(`shortcut`)
);
--> statement-breakpoint
CREATE TABLE `stickers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`sha256` char(64) NOT NULL,
	`storage_path` varchar(500) NOT NULL,
	`file_size` int NOT NULL,
	`animated` boolean NOT NULL DEFAULT false,
	`wa_media_id` varchar(128),
	`wa_media_uploaded_at` datetime(3),
	`usage_count` int NOT NULL DEFAULT 0,
	`last_used_at` datetime(3),
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `stickers_id` PRIMARY KEY(`id`),
	CONSTRAINT `stickers_sha256_unique` UNIQUE(`sha256`)
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `sent_by_system` varchar(32);--> statement-breakpoint
ALTER TABLE `auto_reply_log` ADD CONSTRAINT `auto_reply_log_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `auto_reply_contact_idx` ON `auto_reply_log` (`contact_id`,`day`);