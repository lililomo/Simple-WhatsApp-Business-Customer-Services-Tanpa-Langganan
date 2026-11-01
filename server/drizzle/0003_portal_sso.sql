CREATE TABLE `sso_nonces` (
	`jti` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `sso_nonces_jti` PRIMARY KEY(`jti`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email` varchar(190);--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `password_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `sessions` ADD `max_expires_at` datetime(3);--> statement-breakpoint
ALTER TABLE `users` ADD `auth_source` enum('local','portal') DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `nip` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `seksi` varchar(120);--> statement-breakpoint
ALTER TABLE `users` ADD `jabatan` varchar(190);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_nip_unique` UNIQUE(`nip`);