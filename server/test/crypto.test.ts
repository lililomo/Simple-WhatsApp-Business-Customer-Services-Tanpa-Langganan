import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, randomBase62, safeEqual, sha256Hex } from '../src/lib/crypto';

const key = randomBytes(32);

describe('AES-256-GCM', () => {
  it('round-trips text in v1 format', () => {
    const token = encrypt('EAAG-rahasia-😀', key);
    expect(token.split(':')).toHaveLength(4);
    expect(token.startsWith('v1:')).toBe(true);
    expect(decrypt(token, key)).toBe('EAAG-rahasia-😀');
  });

  it('uses a fresh IV every time', () => {
    expect(encrypt('x', key)).not.toBe(encrypt('x', key));
  });

  it('rejects tampered ciphertext and wrong keys', () => {
    const [v, iv, tag, ct] = encrypt('halo', key).split(':');
    const flipped = Buffer.from(ct!, 'base64url');
    flipped[0]! ^= 1;
    expect(() => decrypt([v, iv, tag, flipped.toString('base64url')].join(':'), key)).toThrow();
    expect(() => decrypt(encrypt('halo', key), randomBytes(32))).toThrow();
  });
});

describe('helpers', () => {
  it('randomBase62 returns requested length and alphabet', () => {
    const value = randomBase62(40);
    expect(value).toMatch(/^[0-9A-Za-z]{40}$/);
  });

  it('sha256Hex and safeEqual', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
