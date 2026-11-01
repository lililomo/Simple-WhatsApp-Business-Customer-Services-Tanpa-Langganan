import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createApiKeyBody } from '@wa/shared';
import { apiKeys } from '../../db/schema';
import { notFound } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireAdminHook, requireUser } from '../auth/plugin';
import { createApiKey, toApiKeyDTO } from './service';

const idParams = z.object({ id: z.coerce.number().int().positive() });

/** Kelola API key (admin, sesi login). */
export async function apiKeyRoutes(app: AppInstance) {
  const { db } = app.deps.database;
  app.addHook('preValidation', requireAdminHook);

  app.get('/', async () => {
    const rows = await db.select().from(apiKeys).orderBy(desc(apiKeys.id));
    return { apiKeys: rows.map(toApiKeyDTO) };
  });

  app.post('/', { schema: { body: createApiKeyBody } }, async (req, reply) => {
    requireUser(req);
    const { row, key } = await createApiKey(db, req.body.name, req.body.scopes, req.user.id);
    await audit(db, { actorUserId: req.user.id, action: 'api_key.create', targetType: 'api_key', targetId: row.id, meta: { scopes: req.body.scopes }, ip: req.ip });
    return reply.status(201).send({ apiKey: toApiKeyDTO(row), key });
  });

  app.delete('/:id', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, req.params.id));
    if (!row) throw notFound('API key');
    if (!row.revokedAt) await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, row.id));
    await audit(db, { actorUserId: req.user.id, action: 'api_key.revoke', targetType: 'api_key', targetId: row.id, ip: req.ip });
    return { ok: true };
  });
}
