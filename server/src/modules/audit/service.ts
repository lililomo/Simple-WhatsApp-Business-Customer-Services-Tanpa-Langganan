import type { Db } from '../../db/client';
import { auditLogs } from '../../db/schema';

export interface AuditEntry {
  actorUserId?: number | null;
  actorApiKeyId?: number | null;
  action: string;
  targetType?: string;
  targetId?: string | number;
  meta?: Record<string, unknown>;
  ip?: string;
}

export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: entry.actorUserId ?? null,
    actorApiKeyId: entry.actorApiKeyId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId === undefined ? null : String(entry.targetId),
    meta: entry.meta ?? null,
    ip: entry.ip ?? null,
  });
}
