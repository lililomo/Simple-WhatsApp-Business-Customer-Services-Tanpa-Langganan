import { pushSubscribeBody, pushUnsubscribeBody } from '@wa/shared';
import type { AppInstance } from '../../types';
import { requireUser, requireUserHook } from '../auth/plugin';
import { getVapidKeys, sendPush, subscribe, unsubscribe, webPushSender } from './service';

/** Langganan notifikasi browser (Web Push) untuk browser yang sedang login. */
export async function pushRoutes(app: AppInstance) {
  const deps = app.deps;
  app.addHook('preValidation', requireUserHook);

  app.get('/key', async () => ({ publicKey: (await getVapidKeys(deps)).publicKey }));

  app.post('/subscribe', { schema: { body: pushSubscribeBody } }, async (req) => {
    requireUser(req);
    await subscribe(deps, req.user.id, req.sessionTokenHash!, req.body, req.headers['user-agent']);
    return { ok: true };
  });

  app.post('/unsubscribe', { schema: { body: pushUnsubscribeBody } }, async (req) => {
    await unsubscribe(deps, req.body.endpoint);
    return { ok: true };
  });

  app.post('/test', async (req) => {
    requireUser(req);
    const sent = await sendPush(
      deps,
      { title: 'WA Inbox', body: 'Notifikasi sudah aktif di browser ini.', conversationId: '', url: '/settings/appearance' },
      webPushSender(deps.config.APP_URL),
      req.user.id,
    );
    return { sent };
  });
}
