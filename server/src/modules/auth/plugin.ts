import fp from 'fastify-plugin';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessions, users } from '../../db/schema';
import { sha256Hex, randomToken } from '../../lib/crypto';
import { AppError, forbidden, unauthorized } from '../../lib/errors';
import type { AppInstance } from '../../types';

export const SESSION_COOKIE = 'wai_sess';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
// Perpanjang sesi paling sering tiap 15 menit agar tidak menulis ke DB di setiap request.
const RENEW_AFTER_MS = 15 * 60 * 1000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireUser(req: FastifyRequest): asserts req is FastifyRequest & { user: NonNullable<FastifyRequest['user']> } {
  if (!req.user) throw unauthorized();
}

export async function requireUserHook(req: FastifyRequest) {
  requireUser(req);
}

export async function requireAdminHook(req: FastifyRequest) {
  requireUser(req);
  if (req.user.role !== 'admin') throw forbidden();
}

export const authPlugin = fp(async (app: AppInstance) => {
  const { config, database } = app.deps;
  const appOrigin = new URL(config.APP_URL).origin;

  app.decorateRequest('user', null);
  app.decorateRequest('sessionTokenHash', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/v1/')) return;

    // Proteksi CSRF untuk API berbasis cookie: request yang mengubah data wajib dari origin aplikasi.
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin ?? refererOrigin(req.headers.referer);
      if (origin !== appOrigin) throw new AppError(403, 'bad_origin', 'Permintaan ditolak: origin tidak valid.');
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const tokenHash = sha256Hex(token);
    const now = new Date();
    const [row] = await database.db
      .select({
        sessionId: sessions.id,
        expiresAt: sessions.expiresAt,
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now), eq(users.isActive, true)))
      .limit(1);
    if (!row) {
      clearSessionCookie(reply, config.secureCookies);
      return;
    }
    req.user = { id: row.id, name: row.name, email: row.email, role: row.role };
    req.sessionTokenHash = tokenHash;

    if (row.expiresAt.getTime() - now.getTime() < SESSION_TTL_MS - RENEW_AFTER_MS) {
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
      await database.db.update(sessions).set({ expiresAt }).where(eq(sessions.id, row.sessionId));
      setSessionCookie(reply, token, expiresAt, config.secureCookies);
    }
  });
});

export async function startSession(
  app: AppInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: number,
): Promise<void> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await app.deps.database.db.insert(sessions).values({
    userId,
    tokenHash: sha256Hex(token),
    expiresAt,
    ip: req.ip,
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 255),
  });
  setSessionCookie(reply, token, expiresAt, app.deps.config.secureCookies);
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, secure: boolean) {
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, secure, sameSite: 'lax', expires: expiresAt });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure, sameSite: 'lax' });
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
