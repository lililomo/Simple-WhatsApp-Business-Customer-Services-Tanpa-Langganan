import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import type { Database } from '../../src/db/client';
import { createUser } from '../../src/modules/users/service';
import type { AppInstance } from '../../src/types';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'password-uji-123';

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    ...process.env,
    APP_URL: ORIGIN,
    DATABASE_URL: process.env.DATABASE_URL_TEST,
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export async function buildTestApp(
  database: Database,
  overrides: Record<string, string> = {},
  fetchFn?: typeof fetch,
): Promise<AppInstance> {
  const app = await buildApp(
    { config: testConfig(overrides), database, fetch: fetchFn },
    { logger: false, webDistDir: '/tidak-ada' },
  );
  await app.ready();
  return app;
}

export function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) throw new Error('Tidak ada cookie di respons');
  return first.split(';')[0]!;
}

export async function seedUser(database: Database, role: 'admin' | 'agent' = 'admin', email = `${role}@kpp.test`) {
  return createUser(database.db, { name: role === 'admin' ? 'Admin' : 'Petugas', email, password: PASSWORD, role });
}

/** Login dan kembalikan header cookie untuk request berikutnya. */
export async function loginAs(app: AppInstance, email: string, password = PASSWORD): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: ORIGIN },
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`Login gagal: ${res.statusCode} ${res.body}`);
  return cookieFrom(res);
}
