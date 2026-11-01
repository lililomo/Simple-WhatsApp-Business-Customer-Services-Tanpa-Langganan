import { z } from 'zod';
import { normalizePhone, startConversationBody } from '@wa/shared';
import { AppError } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireUser, requireUserHook } from '../auth/plugin';
import { requireAccount } from '../connection/service';
import { loadConversation } from '../conversations/dto';
import { sendToConversation } from '../messages/service';
import { upsertContact, upsertConversation } from '../processor/handlers';
import { getTemplate, listTemplates, syncTemplates, templateSpec } from './service';

const listQuery = z.object({ status: z.string().optional() });

export async function templateRoutes(app: AppInstance) {
  const deps = app.deps;
  app.addHook('preHandler', requireUserHook);

  app.get('/', { schema: { querystring: listQuery } }, async (req) => ({ templates: await listTemplates(deps, req.query.status) }));

  app.post('/sync', async (req) => {
    requireUser(req);
    const result = await syncTemplates(deps, await requireAccount(deps));
    await audit(deps.database.db, { actorUserId: req.user.id, action: 'templates.sync', meta: result, ip: req.ip });
    return result;
  });
}

/** POST /api/conversations/start — mulai chat ke nomor baru (wajib template). */
export async function startConversationRoutes(app: AppInstance) {
  const deps = app.deps;
  app.addHook('preHandler', requireUserHook);

  app.post('/start', { schema: { body: startConversationBody } }, async (req, reply) => {
    requireUser(req);
    const waId = normalizePhone(req.body.phone);
    if (!waId) throw new AppError(400, 'invalid_phone', 'Nomor WhatsApp tidak valid. Contoh: 0812-3456-7890.');
    const account = await requireAccount(deps);
    const spec = await templateSpec(deps, await getTemplate(deps, Number(req.body.templateId)), req.body.params);
    const contact = await upsertContact(deps, waId, null, null);
    const conv = await upsertConversation(deps, account.id, contact.id);
    const result = await sendToConversation(deps, conv.id, spec, { userId: req.user.id, ip: req.ip }, { clientRef: req.body.clientRef });
    return reply.status(201).send({ conversation: await loadConversation(deps.database.db, conv.id), message: result.message });
  });
}
