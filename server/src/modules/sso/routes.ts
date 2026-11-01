import { and, eq, lt } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { portalRevokeBody } from '@wa/shared';
import { sessions, ssoNonces, users } from '../../db/schema';
import { AppError, isDuplicateKey } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { startSession } from '../auth/plugin';
import { computeMonthlyStats } from '../stats/service';
import { verifyPortalRequest, verifyTicket } from './signing';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Halaman sederhana bila masuk lewat portal gagal (bukan JSON: pengguna datang dari klik tombol). */
function errorPage(reply: FastifyReply, status: number, message: string, portalUrl: string) {
  return reply
    .status(status)
    .type('text/html; charset=utf-8')
    .send(
      `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WA Inbox</title>` +
        `<style>body{font-family:system-ui,sans-serif;background:#f5f4ef;color:#131b44;display:grid;place-items:center;min-height:100vh;margin:0}` +
        `main{background:#fff;border-radius:16px;padding:32px;max-width:420px;box-shadow:0 1px 3px #0002}a{display:inline-block;margin-top:16px;background:#212c5f;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none}</style></head>` +
        `<body><main><h1 style="font-size:20px;margin:0 0 8px">Tidak bisa masuk</h1><p>${escapeHtml(message)}</p><a href="${escapeHtml(portalUrl)}">Kembali ke kppbwi.app</a></main></body></html>`,
    );
}

/**
 * Masuk lewat portal kppbwi.app (SSO) dan panggilan antarserver dari portal.
 * Di luar /api, jadi pemeriksaan Origin untuk cookie tidak berlaku; semuanya diautentikasi tanda tangan HMAC.
 */
export async function ssoRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  const { PORTAL_SSO_SECRET: secret, PORTAL_URL: portalUrl } = deps.config;

  // Tanda tangan dihitung atas body mentah; form tiket dikirim sebagai application/x-www-form-urlencoded.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, body));

  const requireSecret = () => {
    if (!secret) throw new AppError(503, 'sso_disabled', 'Masuk lewat kppbwi.app belum dikonfigurasi.');
    return secret;
  };

  // Form POST otomatis dari portal: field "ticket" (dan opsional "next").
  app.post('/portal', { config: { rateLimit: { max: 30, timeWindow: 60_000 } } }, async (req, reply) => {
    if (!secret) return errorPage(reply, 503, 'Masuk lewat kppbwi.app belum dikonfigurasi. Hubungi admin.', portalUrl);
    const form = new URLSearchParams(typeof req.body === 'string' ? req.body : '');
    let ticket;
    try {
      ticket = verifyTicket(secret, form.get('ticket') ?? '');
    } catch (err) {
      return errorPage(reply, 401, err instanceof AppError ? err.message : 'Tiket tidak valid.', portalUrl);
    }

    // Satu tiket hanya boleh dipakai sekali (mis. tombol Kembali di browser atau tiket yang bocor).
    await db.delete(ssoNonces).where(lt(ssoNonces.expiresAt, new Date()));
    try {
      await db.insert(ssoNonces).values({ jti: ticket.jti, expiresAt: new Date(ticket.exp * 1000 + 60_000) });
    } catch (err) {
      if (isDuplicateKey(err)) return errorPage(reply, 401, 'Tiket ini sudah dipakai. Klik lagi tombol di kppbwi.app.', portalUrl);
      throw err;
    }

    const profile = { name: ticket.nama, role: ticket.peran, seksi: ticket.seksi || null, jabatan: ticket.jabatan || null, isActive: true };
    await db
      .insert(users)
      .values({ ...profile, nip: ticket.nip, authSource: 'portal', lastLoginAt: new Date() })
      .onDuplicateKeyUpdate({ set: { ...profile, lastLoginAt: new Date() } });
    const [user] = await db.select().from(users).where(eq(users.nip, ticket.nip)).limit(1);
    await startSession(app, req, reply, user!.id, new Date(ticket.sesiBerakhir * 1000));
    await audit(db, { actorUserId: user!.id, action: 'auth.sso_login', meta: { nip: ticket.nip, role: ticket.peran }, ip: req.ip });

    const next = form.get('next') ?? '';
    return reply.redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/chats', 303);
  });

  // Portal: pegawai logout, atau aksesnya dicabut → semua sesi WA Inbox pegawai itu diakhiri.
  app.post('/revoke', async (req) => {
    const raw = typeof req.body === 'string' ? req.body : '';
    verifyPortalRequest(requireSecret(), req, raw);
    const body = portalRevokeBody.parse(JSON.parse(raw || '{}'));
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.nip, body.nip)).limit(1);
    if (!user) return { ok: true, sessions: 0 };
    const [res] = await db.delete(sessions).where(eq(sessions.userId, user.id));
    if (body.nonaktifkan) await db.update(users).set({ isActive: false }).where(and(eq(users.id, user.id), eq(users.authSource, 'portal')));
    await audit(db, { action: body.nonaktifkan ? 'auth.sso_disabled' : 'auth.sso_logout', targetType: 'user', targetId: user.id, meta: { nip: body.nip } });
    return { ok: true, sessions: res.affectedRows };
  });

  // Statistik bulanan untuk halaman pemantauan di portal.
  app.get('/stats', async (req) => {
    verifyPortalRequest(requireSecret(), req, '');
    const month = String((req.query as Record<string, unknown>).month ?? '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError(400, 'invalid_month', 'Format bulan: YYYY-MM.');
    return computeMonthlyStats(deps, month);
  });
}
