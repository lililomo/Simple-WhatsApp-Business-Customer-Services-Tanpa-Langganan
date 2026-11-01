import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ssoTicketPayload, type SsoTicketPayload } from '@wa/shared';
import { AppError } from '../../lib/errors';

// Selisih jam yang masih diterima untuk panggilan antarserver bertanda tangan.
const MAX_SKEW_SEC = 300;

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest();

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Buat tiket (dipakai test; portal membuatnya dengan rumus yang sama di PHP). */
export function signTicket(secret: string, payload: SsoTicketPayload): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(hmac(secret, body))}`;
}

const invalidTicket = (message = 'Tiket masuk dari kppbwi.app tidak valid. Buka lagi dari portal.') =>
  new AppError(401, 'invalid_ticket', message);

/** Periksa tanda tangan, bentuk isi, dan masa berlaku tiket. Anti-replay (jti) diperiksa pemanggil. */
export function verifyTicket(secret: string, ticket: string, nowSec = Math.floor(Date.now() / 1000)): SsoTicketPayload {
  const [body, sig, extra] = ticket.split('.');
  if (!body || !sig || extra !== undefined) throw invalidTicket();
  if (!safeEqual(Buffer.from(sig, 'base64url'), hmac(secret, body))) throw invalidTicket();
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw invalidTicket();
  }
  const parsed = ssoTicketPayload.safeParse(json);
  if (!parsed.success) throw invalidTicket();
  const t = parsed.data;
  if (t.exp < nowSec || t.iat > nowSec + MAX_SKEW_SEC) throw invalidTicket('Tiket masuk sudah kedaluwarsa. Klik lagi tombol di kppbwi.app.');
  if (t.sesiBerakhir <= nowSec) throw invalidTicket('Sesi kppbwi.app Anda sudah berakhir. Masuk lagi ke portal.');
  return t;
}

/**
 * Tanda tangan panggilan antarserver dari portal:
 * header `x-portal-timestamp` (detik unix) dan `x-portal-signature` = hex HMAC(secret, `${ts}.${METHOD} ${url}.${body}`).
 */
export function portalSignature(secret: string, ts: string, method: string, url: string, body: string): string {
  return createHmac('sha256', secret).update(`${ts}.${method.toUpperCase()} ${url}.${body}`).digest('hex');
}

export function verifyPortalRequest(secret: string, req: FastifyRequest, rawBody: string) {
  const ts = String(req.headers['x-portal-timestamp'] ?? '');
  const sig = String(req.headers['x-portal-signature'] ?? '');
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!/^\d+$/.test(ts) || !(age <= MAX_SKEW_SEC)) throw new AppError(401, 'invalid_signature', 'Tanda tangan portal tidak valid.');
  const expected = Buffer.from(portalSignature(secret, ts, req.method, req.url, rawBody), 'hex');
  if (!safeEqual(Buffer.from(sig, 'hex'), expected)) throw new AppError(401, 'invalid_signature', 'Tanda tangan portal tidak valid.');
}
