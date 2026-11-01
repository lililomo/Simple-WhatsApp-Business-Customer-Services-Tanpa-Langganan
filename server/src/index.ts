import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = await buildApp({ config, database });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: '127.0.0.1' });
