import { z } from 'zod';
import { sendMessageBody } from '@wa/shared';
import type { AppInstance } from '../../types';
import { requireUser, requireUserHook } from '../auth/plugin';
import { getTemplate, templateSpec } from '../templates/service';
import { mediaSpec, textSpec } from './build';
import { retryMessage, sendToConversation } from './service';

const idParams = z.object({ id: z.coerce.number().int().positive() });

/** POST /api/conversations/:id/messages — balasan dari petugas lewat UI. */
export async function conversationMessageRoutes(app: AppInstance) {
  const deps = app.deps;
  app.addHook('preValidation', requireUserHook);

  app.post('/:id/messages', { schema: { params: idParams, body: sendMessageBody } }, async (req, reply) => {
    requireUser(req);
    const body = req.body;
    const spec =
      body.type === 'text'
        ? textSpec(body.text)
        : body.type === 'media'
          ? await mediaSpec(deps, Number(body.mediaId), body.caption)
          : await templateSpec(deps, await getTemplate(deps, Number(body.templateId)), body.params);
    const result = await sendToConversation(deps, req.params.id, spec, { userId: req.user.id, ip: req.ip }, {
      clientRef: body.clientRef,
      replyToMessageId: body.type !== 'template' && body.replyTo ? Number(body.replyTo) : null,
    });
    // Penolakan Meta tidak dijadikan error HTTP: pesan tetap tampil di UI dengan status gagal + alasan.
    return reply.status(201).send({ message: result.message });
  });
}

export async function messageRoutes(app: AppInstance) {
  const deps = app.deps;
  app.addHook('preValidation', requireUserHook);

  app.post('/:id/retry', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const result = await retryMessage(deps, req.params.id, { userId: req.user.id, ip: req.ip });
    return { message: result.message };
  });
}
