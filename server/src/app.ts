import Fastify, { type FastifyInstance } from 'fastify';
import type { Health } from '@wa/shared';
import { APP_VERSION } from './version';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get('/healthz', async (): Promise<Health> => ({
    ok: true,
    version: APP_VERSION,
    time: new Date().toISOString(),
  }));

  return app;
}
