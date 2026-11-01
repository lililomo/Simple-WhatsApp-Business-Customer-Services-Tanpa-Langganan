import { and, eq, gt } from 'drizzle-orm';
import { sessions, users } from '../../db/schema';
import type { AppInstance } from '../../types';
import { requireUser, requireUserHook } from '../auth/plugin';

const PING_MS = 20_000;
// Sesi dicek ulang berkala agar pengguna yang dinonaktifkan/keluar berhenti menerima event.
const RECHECK_EVERY = 3;

/** Server-Sent Events: pesan baru dan perubahan status dikirim ke semua pengguna yang login. */
export async function realtimeRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;

  app.get('/events', { preHandler: requireUserHook }, (req, reply) => {
    requireUser(req);
    const tokenHash = req.sessionTokenHash!;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Matikan buffering di reverse proxy agar event langsung sampai.
      'x-accel-buffering': 'no',
    });
    res.write(`retry: 3000\nevent: hello\ndata: {}\n\n`);

    const unsubscribe = deps.bus.on((event) => {
      if (event.type === 'webhook.stored') return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    let ticks = 0;
    const ping = setInterval(async () => {
      res.write(': ping\n\n');
      if (++ticks % RECHECK_EVERY !== 0) return;
      const [valid] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date()), eq(users.isActive, true)))
        .limit(1)
        .catch(() => [{ id: 0 }]);
      if (!valid) res.end();
    }, PING_MS);

    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
    };
    req.raw.on('close', cleanup);
    res.on('close', cleanup);
  });
}
