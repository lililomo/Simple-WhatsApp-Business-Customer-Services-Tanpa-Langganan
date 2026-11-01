import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 26 karakter, bisa diurutkan menurut waktu. Dipakai sebagai ID event webhook keluar. */
export function ulid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (const byte of randomBytes(16)) rand += CROCKFORD[byte % 32];
  return time + rand;
}
