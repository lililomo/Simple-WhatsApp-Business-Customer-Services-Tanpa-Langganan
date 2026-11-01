import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { appSettings } from '../db/schema';

/** Baca pengaturan bersama; kembalikan nilai bawaan bila belum pernah disimpan. */
export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(db: Db, key: string, value: unknown, userId?: number): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedBy: userId ?? null })
    .onDuplicateKeyUpdate({ set: { value, updatedBy: userId ?? null, updatedAt: new Date() } });
}
