import { z } from 'zod';

/**
 * Tiket SSO dari portal kppbwi.app: `base64url(JSON) "." base64url(HMAC-SHA256(secret, bagian pertama))`.
 * Berlaku singkat dan sekali pakai; isinya identitas pegawai dari profil SIKKA/asn-xml portal.
 */
export const ssoTicketPayload = z.object({
  v: z.literal(1),
  /** ID tiket acak (anti-replay). */
  jti: z.string().min(16).max(64),
  nip: z.string().regex(/^\d{9,20}$/),
  nama: z.string().trim().min(1).max(120),
  seksi: z.string().trim().max(120).default(''),
  jabatan: z.string().trim().max(190).default(''),
  peran: z.enum(['admin', 'agent']),
  /** Detik unix. */
  iat: z.number().int(),
  exp: z.number().int(),
  /** Detik unix saat sesi portal berakhir; sesi WA Inbox tidak boleh lebih lama. */
  sesiBerakhir: z.number().int(),
});
export type SsoTicketPayload = z.infer<typeof ssoTicketPayload>;

export const portalRevokeBody = z.object({
  nip: z.string().regex(/^\d{9,20}$/),
  /** true: akses dicabut dari portal (pengguna dinonaktifkan); false: sekadar logout. */
  nonaktifkan: z.boolean().default(false),
});
