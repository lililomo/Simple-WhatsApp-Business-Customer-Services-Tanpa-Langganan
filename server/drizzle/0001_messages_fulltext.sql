-- Pencarian isi pesan memakai indeks FULLTEXT (MATCH … AGAINST) agar tidak memindai seluruh riwayat.
CREATE FULLTEXT INDEX `messages_text_ft` ON `messages` (`text`);
