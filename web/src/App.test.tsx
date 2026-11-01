import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorMessage } from './lib/api';
import { formatListTime } from './lib/format';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api()', () => {
  it('throws ApiError with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'invalid_credentials', message: 'Email atau password salah.' } }), {
          status: 401,
        }),
      ),
    );
    const err = await api('/api/auth/login', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('invalid_credentials');
    expect(errorMessage(err)).toBe('Email atau password salah.');
  });

  it('sends JSON only when a body is given', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/api/auth/logout', { method: 'POST' });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });
});

describe('formatListTime', () => {
  const now = new Date('2026-11-01T10:00:00');
  it('shows time today, Kemarin yesterday, date otherwise', () => {
    expect(formatListTime(new Date('2026-11-01T08:05:00').toISOString(), now)).toBe('08:05');
    expect(formatListTime(new Date('2026-10-31T08:05:00').toISOString(), now)).toBe('Kemarin');
    expect(formatListTime(new Date('2026-10-20T08:05:00').toISOString(), now)).toBe('20 Okt');
  });
});
