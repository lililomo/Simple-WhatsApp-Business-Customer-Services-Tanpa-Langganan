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
  await app.register(authPlugin);

  app.get('/healthz', async (): Promise<Health> => ({
    ok: true,
    version: APP_VERSION,
    time: new Date().toISOString(),
  }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await registerSpa(app, opts.webDistDir);

  return app;
}
