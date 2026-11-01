import { describe, expect, it } from 'vitest';
import { healthSchema } from '@wa/shared';
import { buildTestApp } from './helpers/app';
import { useTestDatabase } from './helpers/db';

const t = useTestDatabase();

describe('GET /healthz', () => {
  it('returns ok with version', async () => {
    const app = await buildTestApp(t.get());
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = healthSchema.parse(res.json());
    expect(body.ok).toBe(true);
    expect(body.version).toBe('dev');
    await app.close();
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const app = await buildTestApp(t.get());
    const res = await app.inject({ method: 'GET', url: '/api/tidak-ada' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await app.close();
  });
});
