import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const base = {
  APP_URL: 'https://wa.example.id',
  DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/db',
  APP_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadConfig', () => {
  it('applies defaults and derives secure cookies from APP_URL', () => {
    const cfg = loadConfig(base);
    expect(cfg.PORT).toBe(3210);
    expect(cfg.SEND_READ_RECEIPTS).toBe(true);
    expect(cfg.appKey).toHaveLength(32);
    expect(cfg.secureCookies).toBe(true);
    expect(loadConfig({ ...base, APP_URL: 'http://localhost:5173' }).secureCookies).toBe(false);
  });

  it('parses boolean strings', () => {
    expect(loadConfig({ ...base, SEND_READ_RECEIPTS: 'false' }).SEND_READ_RECEIPTS).toBe(false);
  });

  it('reports invalid values in Indonesian', () => {
    expect(() => loadConfig({ ...base, APP_KEY: 'pendek' })).toThrow(/APP_KEY harus 32 byte/);
    expect(() => loadConfig({ APP_KEY: base.APP_KEY })).toThrow(/Konfigurasi .env tidak valid/);
  });
});
