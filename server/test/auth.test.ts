import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sessions, users } from '../src/db/schema';
import type { AppInstance } from '../src/types';
import { buildTestApp, cookieFrom, loginAs, ORIGIN, PASSWORD, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';

const t = useTestDatabase();
let app: AppInstance;

afterEach(async () => {
  await app?.close();
});

describe('auth', () => {
  it('logs in, returns the user, and logs out', async () => {
    app = await buildTestApp(t.get());
    await seedUser(t.get(), 'admin', 'admin@kpp.test');

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'ADMIN@kpp.test', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toMatch(/wai_sess=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const cookie = cookieFrom(login);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ email: 'admin@kpp.test', role: 'admin' });
    expect(me.json().user.passwordHash).toBeUndefined();

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, origin: ORIGIN } });
    expect(out.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('rejects wrong passwords and unknown emails with the same message', async () => {
    app = await buildTestApp(t.get());
    await seedUser(t.get());
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'admin@kpp.test', password: 'salah-sekali' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'tidak@ada.test', password: 'salah-sekali' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error).toEqual(unknown.json().error);
  });

  it('rate limits repeated login attempts', async () => {
    app = await buildTestApp(t.get());
    await seedUser(t.get());
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: ORIGIN },
        payload: { email: 'admin@kpp.test', password: 'salah-sekali' },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[5]).toBe(429);
  });

  it('blocks state-changing requests from another origin', async () => {
    app = await buildTestApp(t.get());
    await seedUser(t.get());
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://jahat.example' },
      payload: { email: 'admin@kpp.test', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('bad_origin');
  });

  it('requires login for protected routes', async () => {
    app = await buildTestApp(t.get());
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('changes the password with the current one', async () => {
    app = await buildTestApp(t.get());
    await seedUser(t.get());
    const cookie = await loginAs(app, 'admin@kpp.test');
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: { cookie, origin: ORIGIN },
      payload: { currentPassword: 'keliru-keliru', newPassword: 'password-baru-123' },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: { cookie, origin: ORIGIN },
      payload: { currentPassword: PASSWORD, newPassword: 'password-baru-123' },
    });
    expect(ok.statusCode).toBe(200);
    await expect(loginAs(app, 'admin@kpp.test', 'password-baru-123')).resolves.toMatch(/wai_sess=/);
  });
});

describe('users (admin)', () => {
  it('forbids agents from managing users', async () => {
    app = await buildTestApp(t.get());
    await seedUser(t.get(), 'agent', 'petugas@kpp.test');
    const cookie = await loginAs(app, 'petugas@kpp.test');
    const res = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('creates, deactivates (revoking sessions) and protects the last admin', async () => {
    app = await buildTestApp(t.get());
    const admin = await seedUser(t.get());
    const cookie = await loginAs(app, 'admin@kpp.test');

    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie, origin: ORIGIN },
      payload: { name: 'Petugas Satu', email: 'satu@kpp.test', password: 'password-satu-123', role: 'agent' },
    });
    expect(created.statusCode).toBe(201);
    const agentId = created.json().user.id as string;

    const agentCookie = await loginAs(app, 'satu@kpp.test', 'password-satu-123');
    const deactivate = await app.inject({
      method: 'PATCH',
      url: `/api/users/${agentId}`,
      headers: { cookie, origin: ORIGIN },
      payload: { isActive: false },
    });
    expect(deactivate.statusCode).toBe(200);
    expect(await t.get().db.$count(sessions, eq(sessions.userId, Number(agentId)))).toBe(0);
    const agentMe = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: agentCookie } });
    expect(agentMe.statusCode).toBe(401);

    const demoteSelf = await app.inject({
      method: 'PATCH',
      url: `/api/users/${admin.id}`,
      headers: { cookie, origin: ORIGIN },
      payload: { role: 'agent' },
    });
    expect(demoteSelf.statusCode).toBe(400);
    expect(demoteSelf.json().error.code).toBe('last_admin');

    const list = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(list.json().users).toHaveLength(2);
    const stored = await t.get().db.query.users.findFirst({ where: eq(users.email, 'satu@kpp.test') });
    expect(stored?.isActive).toBe(false);
  });

  it('validates input with readable messages', async () => {
    app = await buildTestApp(t.get());
    await seedUser(t.get());
    const cookie = await loginAs(app, 'admin@kpp.test');
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie, origin: ORIGIN },
      payload: { name: 'X', email: 'bukan-email', password: 'pendek', role: 'agent' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });
});
