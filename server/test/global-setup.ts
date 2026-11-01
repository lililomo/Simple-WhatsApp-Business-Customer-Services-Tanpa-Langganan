import './setup-env';
import { createDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

// Sekali per run: kosongkan database test lalu jalankan semua migrasi dari awal.
export default async function globalSetup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST belum diisi di .env');
  const database = createDatabase(url, 1);
  const conn = await database.pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()');
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { t } of rows as { t: string }[]) await conn.query(`DROP TABLE \`${t}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
  await runMigrations(database.db);
  await database.close();
}
