import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { registerPhoneBody, saveConnectionBody, validateConnectionBody, type ConnectionStatusDTO } from '@wa/shared';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireAdminHook, requireUser, requireUserHook } from '../auth/plugin';
import {
  checkConnection,
  getAccount,
  listPhoneNumbers,
  registerPhone,
  requireAccount,
  saveConnection,
  toConnectionDTO,
  validateCredentials,
} from './service';

export async function connectionRoutes(app: AppInstance) {
  const deps = app.deps;
  const db = deps.database.db;
  const appUrl = deps.config.APP_URL;

  // Ringkasan status untuk banner, boleh dilihat semua pengguna.
  app.get('/status', { preHandler: requireUserHook }, async (): Promise<ConnectionStatusDTO> => {
    const account = await getAccount(deps);
    return {
      connected: !!account,
      status: account?.status ?? null,
      displayPhoneNumber: account?.displayPhoneNumber ?? null,
      verifiedName: account?.verifiedName ?? null,
      lastError: account?.lastError ?? null,
      lastWebhookAt: account?.lastWebhookAt?.toISOString() ?? null,
    };
  });

  app.register(async (instance) => {
    const admin = instance.withTypeProvider<ZodTypeProvider>();
    admin.addHook('preHandler', requireAdminHook);

    admin.get('/', async () => {
      const account = await getAccount(deps);
      return { connection: account ? toConnectionDTO(account, appUrl) : null };
    });

    admin.post('/validate', { schema: { body: validateConnectionBody } }, async (req) =>
      validateCredentials(deps, req.body),
    );

    admin.put('/', { schema: { body: saveConnectionBody } }, async (req) => {
      requireUser(req);
      const account = await saveConnection(deps, req.body);
      await audit(db, {
        actorUserId: req.user.id,
        action: 'connection.save',
        targetType: 'wa_account',
        targetId: account.id,
        meta: { wabaId: account.wabaId, phoneNumberId: account.phoneNumberId, tokenChanged: !!req.body.accessToken },
        ip: req.ip,
      });
      deps.bus.emit({ type: 'connection.updated' });
      return { connection: toConnectionDTO(account, appUrl) };
    });

    admin.get('/phone-numbers', async () => ({ phoneNumbers: await listPhoneNumbers(deps, await requireAccount(deps)) }));

    admin.post('/check', async () => {
      const items = await checkConnection(deps, await requireAccount(deps));
      deps.bus.emit({ type: 'connection.updated' });
      return { items, connection: toConnectionDTO((await getAccount(deps))!, appUrl) };
    });

    admin.post('/register', { schema: { body: registerPhoneBody } }, async (req) => {
      requireUser(req);
      const account = await requireAccount(deps);
      await registerPhone(deps, account, req.body.pin);
      await audit(db, { actorUserId: req.user.id, action: 'connection.register', targetType: 'wa_account', targetId: account.id, ip: req.ip });
      return { ok: true };
    });
  });
}
