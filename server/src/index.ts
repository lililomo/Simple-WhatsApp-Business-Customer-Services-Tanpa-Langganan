import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { EventBus } from './lib/bus';
import { WebhookWorker } from './modules/processor/worker';
import { WebhookDispatcher } from './modules/webhook-out/dispatcher';
import { PushNotifier } from './modules/push/service';
import type { AppDeps } from './types';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const deps: AppDeps = { config, database, bus: new EventBus() };
const app = await buildApp(deps);
deps.log = app.log;
const webhookWorker = new WebhookWorker(deps, app.log);
const dispatcher = new WebhookDispatcher(deps, app.log);
const pushNotifier = new PushNotifier(deps);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await Promise.all([webhookWorker.stop(), dispatcher.stop()]);
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: '127.0.0.1' });
webhookWorker.start();
dispatcher.start();
pushNotifier.start();
