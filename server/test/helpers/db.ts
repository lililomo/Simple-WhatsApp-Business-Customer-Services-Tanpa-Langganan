import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createDatabase, type Database } from '../../src/db/client';

/** Database test untuk satu file test; semua tabel dikosongkan sebelum setiap test. */
export function useTestDatabase(): { get: () => Database } {
  let database: Database | undefined;

  beforeAll(() => {
    database = createDatabase(process.env.DATABASE_URL_TEST!, 4);
  });

  beforeEach(async () => {
    await truncateAll(database!);
  });

  afterAll(async () => {
    await database?.close();
  });

  return { get: () => database! };
}

export async function truncateAll(database: Database): Promise<void> {
  const conn = await database.pool.getConnection();
  try {
    const [rows] = await conn.query(
      "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> '__drizzle_migrations'",
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { t } of rows as { t: string }[]) await conn.query(`TRUNCATE TABLE \`${t}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
}
