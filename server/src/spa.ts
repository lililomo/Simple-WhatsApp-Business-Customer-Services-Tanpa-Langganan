import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { AppInstance } from './types';

// server/src dan server/dist sama-sama dua tingkat di bawah root repo.
export const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

/** Melayani hasil build web (SPA). Di pengembangan, Vite yang melayani web. */
export async function registerSpa(app: AppInstance, dir = webDistDir) {
  const hasWeb = existsSync(`${dir}/index.html`);
  if (hasWeb) {
    await app.register(fastifyStatic, { root: dir, wildcard: false, index: false });
  }

  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith('/api/') || req.url.startsWith('/webhooks/');
    if (!isApi && hasWeb && req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'not_found', message: 'Alamat tidak ditemukan.' } });
  });
}
