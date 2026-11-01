import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Config } from './config';
import type { Database } from './db/client';
import type { EventBus } from './lib/bus';
import type { Role } from '@wa/shared';

export interface AppDeps {
  config: Config;
  database: Database;
  bus: EventBus;
  /** fetch untuk Graph API; diganti mock di test. */
  fetch?: typeof fetch;
  /** Logger aplikasi untuk pekerjaan di luar request (worker); diisi setelah app dibuat. */
  log?: Pick<FastifyBaseLogger, 'warn' | 'error'>;
}

export type AppInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>;

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
  interface FastifyRequest {
    user: SessionUser | null;
    sessionTokenHash: string | null;
  }
}
