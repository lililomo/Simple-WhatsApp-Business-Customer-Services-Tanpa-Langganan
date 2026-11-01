CREATE TABLE `message_pricing` (
	`wamid` varchar(128) NOT NULL,
	`category` varchar(32),
	`type` varchar(32),
	`subtype` varchar(32),
	`billable` boolean,
	`delivered_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `message_pricing_wamid` PRIMARY KEY(`wamid`)
);
--> statement-breakpoint
CREATE INDEX `message_pricing_delivered_idx` ON `message_pricing` (`delivered_at`);
--> statement-breakpoint
-- Isi awal dari pesan keluar WA Inbox yang sudah punya data pricing (sebelum tabel ini ada).
INSERT IGNORE INTO `message_pricing` (`wamid`, `category`, `billable`, `delivered_at`, `created_at`)
SELECT `wamid`, `pricing_category`, `pricing_billable`, COALESCE(`delivered_at`, `read_at`), `created_at`
FROM `messages`
WHERE `direction` = 'out' AND `wamid` IS NOT NULL AND `pricing_category` IS NOT NULL;
