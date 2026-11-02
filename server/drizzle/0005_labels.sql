CREATE TABLE `contact_labels` (
	`contact_id` bigint unsigned NOT NULL,
	`label_id` bigint unsigned NOT NULL,
	`created_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `contact_labels_contact_id_label_id_pk` PRIMARY KEY(`contact_id`,`label_id`)
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(40) NOT NULL,
	`color` char(7) NOT NULL,
	`created_by` bigint unsigned,
	`updated_by` bigint unsigned,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `labels_id` PRIMARY KEY(`id`),
	CONSTRAINT `labels_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `contact_labels` ADD CONSTRAINT `contact_labels_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contact_labels` ADD CONSTRAINT `contact_labels_label_id_labels_id_fk` FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `contact_labels_label_idx` ON `contact_labels` (`label_id`);--> statement-breakpoint
-- Label awal permintaan pemilik; petugas bisa menambah, mengubah warna, atau menghapusnya di Pengaturan > Label.
INSERT IGNORE INTO `labels` (`name`, `color`, `created_at`, `updated_at`) VALUES
	('Pelayanan', '#2563EB', NOW(3), NOW(3)),
	('Penyuluh', '#16A34A', NOW(3), NOW(3));
