import type { FastifyServerOptions } from 'fastify';

// Nilai rahasia tidak boleh pernah tertulis di log.
export const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.access_token',
  '*.accessToken',
  '*.app_secret',
  '*.appSecret',
  '*.token',
  '*.secret',
];

export function loggerOptions(level: string): FastifyServerOptions['logger'] {
  return { level, redact: { paths: redactPaths, censor: '[redacted]' } };
}
