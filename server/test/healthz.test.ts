import { describe, expect, it } from 'vitest';
import { healthSchema } from '@wa/shared';
import { buildApp } from '../src/app';

describe('GET /healthz', () => {
  it('returns ok with version', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = healthSchema.parse(res.json());
    expect(body.ok).toBe(true);
    expect(body.version).toBe('dev');
    await app.close();
  });
});
