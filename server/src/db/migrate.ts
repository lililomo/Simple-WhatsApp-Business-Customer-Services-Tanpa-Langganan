import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import type { Db } from './client';

// src/db/../../drizzle saat dev (tsx) dan dist/../drizzle setelah build berada di folder yang sama: server/drizzle.
const migrationsFolder = fileURLToPath(new URL(import.meta.url.includes('/dist/') ? '../drizzle' : '../../drizzle', import.meta.url));

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}
