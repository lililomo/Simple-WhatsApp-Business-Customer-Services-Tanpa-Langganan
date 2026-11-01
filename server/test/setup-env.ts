import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // .env opsional (mis. di CI); variabel bisa datang dari environment.
}
process.env.NODE_ENV = 'test';
