import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

export type Db = MySql2Database<typeof schema>;

export interface Database {
  db: Db;
  pool: mysql.Pool;
  close: () => Promise<void>;
}

export function createDatabase(url: string, connectionLimit = 10): Database {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit,
    // Semua waktu disimpan dan dibaca dalam UTC.
    timezone: 'Z',
    supportBigNumbers: true,
    charset: 'utf8mb4',
  });
  pool.pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool, close: () => pool.end() };
}
