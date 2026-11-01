import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Format kolom *_enc: v1:<iv>:<tag>:<ciphertext>, semuanya base64url (AES-256-GCM).
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
}

export function decrypt(token: string, key: Buffer): string {
  const [version, iv, tag, ct] = token.split(':');
  if (version !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Format data terenkripsi tidak dikenal');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256Hex(secret: string, value: string | Buffer): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      // Tolak nilai >= 248 agar distribusi merata (248 = 62 * 4).
      if (byte < 248 && out.length < length) out += BASE62[byte % 62];
    }
  }
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
