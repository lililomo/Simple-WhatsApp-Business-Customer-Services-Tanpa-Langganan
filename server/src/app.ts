import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Health } from '@wa/shared';
import { errorHandler } from './lib/error-handler';
import { AppError } from './lib/errors';
import { loggerOptions } from './lib/logger';
import { authPlugin } from './modules/auth/plugin';
import { authRoutes } from './modules/auth/routes';
import { connectionRoutes } from './modules/connection/routes';
import { adminRoutes } from './modules/admin/routes';
import { mediaRoutes } from './modules/media/routes';
import { contactRoutes, conversationRoutes } from './modules/conversations/routes';
import { realtimeRoutes } from './modules/realtime/routes';
import { conversationMessageRoutes, messageRoutes } from './modules/messages/routes';
import multipart from '@fastify/multipart';
import { startConversationRoutes, templateRoutes } from './modules/templates/routes';
import { webhookInRoutes } from './modules/webhook-in/routes';
import { userRoutes } from './modules/users/routes';
import { registerSpa } from './spa';
import type { AppDeps, AppInstance } from './types';
import { APP_VERSION } from './version';

export interface BuildOptions {
  logger?: boolean;
  webDistDir?: string;
}

export async function buildApp(deps: AppDeps, opts: BuildOptions = {}): Promise<AppInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : loggerOptions(deps.config.LOG_LEVEL),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    // Koneksi SSE yang terbuka tidak boleh menahan restart.
    forceCloseConnections: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.decorate('deps', deps);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new AppError(429, 'rate_limited', 'Terlalu banyak permintaan. Coba lagi sebentar lagi.'),
  });
  await app.register(multipart, { limits: { fileSize: deps.config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 } });
  await app.register(authPlugin);

  app.get('/healthz', async (): Promise<Health> => ({
    ok: true,
    version: APP_VERSION,
    time: new Date().toISOString(),
  }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(connectionRoutes, { prefix: '/api/connection' });
  await app.register(conversationRoutes, { prefix: '/api/conversations' });
  await app.register(conversationMessageRoutes, { prefix: '/api/conversations' });
  await app.register(startConversationRoutes, { prefix: '/api/conversations' });
  await app.register(templateRoutes, { prefix: '/api/templates' });
  await app.register(messageRoutes, { prefix: '/api/messages' });
  await app.register(contactRoutes, { prefix: '/api/contacts' });
  await app.register(realtimeRoutes, { prefix: '/api' });
  await app.register(mediaRoutes, { prefix: '/api/media' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(webhookInRoutes, { prefix: '/webhooks' });
  await registerSpa(app, opts.webDistDir);

  return app;
}
