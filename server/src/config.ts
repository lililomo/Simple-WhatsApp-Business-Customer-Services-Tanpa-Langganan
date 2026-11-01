import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3210),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  APP_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_KEY harus 32 byte dalam base64'),
  STORAGE_DIR: z.string().default('./storage'),
  GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v26.0'),
  MEDIA_RETENTION_DAYS: z.coerce.number().int().min(0).default(365),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(100),
  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
  SEND_READ_RECEIPTS: z.stringbool().default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Portal kppbwi.app: pegawai masuk lewat portal (SSO), bukan login tersendiri. */
  PORTAL_URL: z.url().default('https://kppbwi.app'),
  /** Kunci HMAC bersama dengan portal (tiket SSO + panggilan antarserver). Kosong = SSO mati. */
  PORTAL_SSO_SECRET: z.string().min(32, 'PORTAL_SSO_SECRET minimal 32 karakter').optional(),
});

export type Config = z.infer<typeof envSchema> & { appKey: Buffer; secureCookies: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Konfigurasi .env tidak valid:\n${issues}`);
  }
  const cfg = parsed.data;
  return {
    ...cfg,
    appKey: Buffer.from(cfg.APP_KEY, 'base64'),
    secureCookies: cfg.APP_URL.startsWith('https://'),
  };
}
