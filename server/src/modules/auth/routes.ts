import { eq } from 'drizzle-orm';
import { changePasswordBody, loginBody } from '@wa/shared';
import { sessions, users } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { toUserDTO } from '../users/dto';
import { normalizeEmail, setPassword } from '../users/service';
import { randomToken } from '../../lib/crypto';
import { hashPassword, verifyPassword } from './password';
import { clearSessionCookie, requireUser, requireUserHook, startSession } from './plugin';

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 60_000;

const invalidLogin = () => new AppError(401, 'invalid_credentials', 'Email atau password salah.');

export async function authRoutes(app: AppInstance) {
  const { database, config } = app.deps;
  const db = database.db;
  const attemptsByEmail = new Map<string, number[]>();
  // Hash dummy agar waktu respons sama baik email terdaftar maupun tidak.
  const dummyHash = hashPassword(randomToken(16));

  app.post(
    '/login',
    {
      schema: { body: loginBody },
      config: { rateLimit: { max: LOGIN_LIMIT, timeWindow: LOGIN_WINDOW_MS } },
    },
    async (req, reply) => {
      const email = normalizeEmail(req.body.email);
      const now = Date.now();
      const recent = (attemptsByEmail.get(email) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
      if (recent.length >= LOGIN_LIMIT) {
        throw new AppError(429, 'rate_limited', 'Terlalu banyak percobaan masuk. Coba lagi dalam 1 menit.');
      }
      recent.push(now);
      attemptsByEmail.set(email, recent);

      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash), req.body.password);
      if (!user || !ok || !user.isActive) {
        await audit(db, { action: 'auth.login_failed', meta: { email }, ip: req.ip });
        throw invalidLogin();
      }

      attemptsByEmail.delete(email);
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await startSession(app, req, reply, user.id);
      await audit(db, { actorUserId: user.id, action: 'auth.login', ip: req.ip });
      return { user: toUserDTO(user) };
    },
  );

  app.post('/logout', async (req, reply) => {
    if (req.sessionTokenHash) await db.delete(sessions).where(eq(sessions.tokenHash, req.sessionTokenHash));
    clearSessionCookie(reply, config.secureCookies);
    return { ok: true };
  });

  app.get('/me', { preHandler: requireUserHook }, async (req) => {
    requireUser(req);
    const user = await db.query.users.findFirst({ where: eq(users.id, req.user.id) });
    return { user: toUserDTO(user!) };
  });

  app.patch('/password', { preHandler: requireUserHook, schema: { body: changePasswordBody } }, async (req) => {
    requireUser(req);
    const user = await db.query.users.findFirst({ where: eq(users.id, req.user.id) });
    if (!user || !(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
      throw new AppError(400, 'wrong_password', 'Password lama salah.');
    }
    await setPassword(db, user.id, req.body.newPassword);
    await audit(db, { actorUserId: user.id, action: 'auth.password_changed', ip: req.ip });
    return { ok: true };
  });
}
