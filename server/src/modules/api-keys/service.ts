import { and, eq, isNull } from 'drizzle-orm';
import type { ApiKeyDTO, ApiScope } from '@wa/shared';
import type { Db } from '../../db/client';
import { apiKeys } from '../../db/schema';
import { randomBase62, sha256Hex } from '../../lib/crypto';

export type ApiKeyRow = typeof apiKeys.$inferSelect;

export function toApiKeyDTO(k: ApiKeyRow): ApiKeyDTO {
  return {
    id: String(k.id),
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes as ApiScope[],
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  };
}

/** Buat API key baru. Nilai lengkap hanya dikembalikan sekali; DB menyimpan hash SHA-256. */
export async function createApiKey(db: Db, name: string, scopes: ApiScope[], createdBy: number | null): Promise<{ row: ApiKeyRow; key: string }> {
  const key = `wai_${randomBase62(40)}`;
  const [res] = await db.insert(apiKeys).values({ name, prefix: key.slice(0, 12), keyHash: sha256Hex(key), scopes, createdBy });
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, res.insertId));
  return { row: row!, key };
}

export async function findActiveKey(db: Db, key: string): Promise<ApiKeyRow | undefined> {
  if (!/^wai_[0-9A-Za-z]{40}$/.test(key)) return undefined;
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, sha256Hex(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  return row;
}
