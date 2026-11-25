import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import {
  assistantSettings,
  type AosPlaygroundDTO,
  type AosUsageDTO,
  type AssistantSettings,
  type AssistantSettingsDTO,
} from '@wa/shared';
import { checkSettings, cleanDomain, currentMonthWib, formatUsd, fullOrder } from './assistant/helpers';
import { AssistantSettingsPage } from './AssistantSettingsPage';

const settings: AssistantSettings = assistantSettings.parse({
  enabled: true,
  order: ['subscription', 'api'],
});

const dto = (over: Partial<AssistantSettingsDTO> = {}): AssistantSettingsDTO => ({
  settings,
  providers: [
    {
      provider: 'subscription',
      connected: true,
      last4: 'q9Zx',
      state: 'ok',
      cooldownUntil: null,
      lastError: null,
      lastUsedAt: '2026-11-24T02:00:00.000Z',
    },
    {
      provider: 'api',
      connected: false,
      last4: null,
      state: 'unknown',
      cooldownUntil: null,
      lastError: null,
      lastUsedAt: null,
    },
  ],
  ready: true,
  monthCostUsd: 1.5,
  ...over,
});

const usage: AosUsageDTO = {
  month: '2026-11',
  totals: { calls: 1234, inputTokens: 500_000, outputTokens: 42_000, costUsd: 3.456 },
  byDay: [],
  byProvider: [
    { provider: 'subscription', calls: 1000, costUsd: 0, failed: 2 },
    { provider: 'api', calls: 234, costUsd: 3.456, failed: 0 },
  ],
  byPurpose: [
    { purpose: 'triage', calls: 900, costUsd: 0.4 },
    { purpose: 'answer', calls: 334, costUsd: 3.056 },
  ],
  byModel: [{ model: 'claude-opus-5-5', calls: 334, costUsd: 3.056 }],
  answers: { made: 40, used: 30, up: 12, down: 3 },
  offers: { made: 80, answered: 40, dismissed: 25 },
  topics: [
    { topic: 'Aktivasi EFIN', count: 21 },
    { topic: 'Lapor SPT Tahunan', count: 34 },
  ],
  categories: [{ category: 'layanan', count: 55 }],
};

type Call = [string, RequestInit | undefined];

/** fetch tiruan untuk halaman ini. `extra` menangani permintaan selain pengaturan dan pemakaian. */
function mockFetch(
  initial: AssistantSettingsDTO,
  extra: (url: string, init?: RequestInit) => unknown = () => ({}),
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (url === '/api/assistant/settings') {
      body =
        method === 'PUT'
          ? { ...initial, settings: JSON.parse(init!.body as string) as AssistantSettings }
          : initial;
    } else if (url.startsWith('/api/assistant/usage')) {
      body = usage;
    } else {
      body = extra(url, init);
    }
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const calls = () => fetchMock.mock.calls as unknown as Call[];
  return {
    calls,
    sent: (method: string) => calls().filter(([, init]) => (init?.method ?? 'GET') === method),
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AssistantSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Nama jalur menurut urutan tampil, beserta perannya. */
const providerCards = () =>
  screen
    .getAllByRole('region', { name: /^(Langganan|API) Claude$/ })
    .map(
      (card) =>
        `${within(card).getByText(/^(Utama|Cadangan)$/).textContent}: ${within(card).getByRole('heading').textContent}`,
    );
const saveButton = () => screen.queryByRole('button', { name: 'Simpan' }) as HTMLButtonElement | null;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AssistantSettingsPage', () => {
  it('shows the two connections in the saved order, with their state', async () => {
    mockFetch(dto());
    renderPage();

    const subscription = within(await screen.findByRole('region', { name: 'Langganan Claude' }));
    expect(providerCards()).toEqual(['Utama: Langganan Claude', 'Cadangan: API Claude']);
    expect(subscription.getByText('Terhubung')).toBeTruthy();
    expect(subscription.getByText('•••• q9Zx')).toBeTruthy();
    expect(subscription.getByRole('button', { name: /Uji koneksi/ })).toBeTruthy();

    const apiCard = within(screen.getByRole('region', { name: 'API Claude' }));
    expect(apiCard.getByText('Belum terhubung')).toBeTruthy();
    expect(apiCard.getByRole('button', { name: /Hubungkan/ })).toBeTruthy();
    expect(apiCard.queryByRole('button', { name: /Uji koneksi/ })).toBeNull();

    expect(screen.getByText('AOS aktif')).toBeTruthy();
    expect(screen.getByText('$1.50')).toBeTruthy();
    expect(saveButton()).toBeNull();
  });

  it('swaps the order with "Tukar urutan" and offers to save', async () => {
    mockFetch(dto());
    renderPage();
    await screen.findByRole('region', { name: 'API Claude' });

    fireEvent.click(screen.getByRole('button', { name: /Tukar urutan/ }));
    expect(providerCards()).toEqual(['Utama: API Claude', 'Cadangan: Langganan Claude']);
    expect(saveButton()?.disabled).toBe(false);

    // Kembali ke urutan semula: tidak ada lagi yang perlu disimpan.
    fireEvent.click(screen.getByRole('button', { name: /Tukar urutan/ }));
    expect(providerCards()).toEqual(['Utama: Langganan Claude', 'Cadangan: API Claude']);
    expect(saveButton()).toBeNull();
  });

  it('saves the whole settings object, not just the changed part', async () => {
    const api = mockFetch(dto());
    renderPage();
    await screen.findByRole('region', { name: 'API Claude' });

    fireEvent.click(screen.getByRole('button', { name: /Tukar urutan/ }));
    fireEvent.change(screen.getByLabelText('Jeda sebelum membaca pesan (detik)'), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Otomatis/ }));
    fireEvent.click(saveButton()!);

    await waitFor(() => expect(api.sent('PUT')).toHaveLength(1));
    const [url, init] = api.sent('PUT')[0]!;
    expect(url).toBe('/api/assistant/settings');
    expect(JSON.parse(init!.body as string)).toEqual({
      ...settings,
      order: ['api', 'subscription'],
      triage: { ...settings.triage, debounceSec: 12, mode: 'auto' },
    });
    // Setelah tersimpan, bilah simpan hilang dan urutan baru tetap tampil.
    await waitFor(() => expect(saveButton()).toBeNull());
    expect(providerCards()).toEqual(['Utama: API Claude', 'Cadangan: Langganan Claude']);
  });

  it('blocks saving while a value is outside the allowed range', async () => {
    const api = mockFetch(dto());
    renderPage();
    await screen.findByRole('region', { name: 'API Claude' });

    fireEvent.change(screen.getByLabelText('Jeda sebelum membaca pesan (detik)'), {
      target: { value: '99' },
    });
    expect(screen.getByText('Jeda deteksi awal: isi bilangan bulat 2 sampai 60 detik.')).toBeTruthy();
    expect(saveButton()?.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Batalkan' }));
    expect(saveButton()).toBeNull();
    expect((screen.getByLabelText('Jeda sebelum membaca pesan (detik)') as HTMLInputElement).value).toBe('8');
    expect(api.sent('PUT')).toHaveLength(0);
  });

  it('edits the list of allowed sites', async () => {
    mockFetch(dto());
    renderPage();
    const sites = () =>
      within(screen.getByRole('list', { name: 'Situs yang diizinkan' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
    await screen.findByRole('region', { name: 'API Claude' });
    expect(sites()).toContain('pajak.go.id');

    const input = screen.getByLabelText('Situs yang diizinkan', { selector: 'input' });
    fireEvent.change(input, { target: { value: 'bukan situs!' } });
    fireEvent.click(screen.getByRole('button', { name: /Tambah/ }));
    expect(screen.getByText(/tidak bisa dipakai/)).toBeTruthy();

    fireEvent.change(input, { target: { value: 'https://JDIH.Kemenkeu.go.id/dok/123' } });
    fireEvent.click(screen.getByRole('button', { name: /Tambah/ }));
    expect(sites()).toContain('jdih.kemenkeu.go.id');

    fireEvent.click(screen.getByRole('button', { name: 'Hapus pajak.go.id' }));
    expect(sites()).not.toContain('pajak.go.id');

    fireEvent.click(screen.getByRole('button', { name: 'Kembalikan daftar bawaan' }));
    expect(sites()).toEqual(settings.sources.domains);
    expect(saveButton()).toBeNull();
  });

  it('connects the subscription by link: sign in on Claude, then paste the code', async () => {
    const disconnected = dto({
      ready: false,
      providers: dto().providers.map((p) =>
        p.provider === 'subscription' ? { ...p, connected: false, last4: null, state: 'unknown' as const, lastUsedAt: null } : p,
      ),
    });
    const connected = dto({
      providers: dto().providers.map((p) => (p.provider === 'subscription' ? { ...p, last4: 'QwEr' } : p)),
    });
    const api = mockFetch(disconnected, (url) => {
      if (url.endsWith('/subscription/login')) return { url: 'https://claude.ai/oauth/authorize?abc123', expiresAt: '2026-11-26T01:00:00.000Z' };
      if (url.endsWith('/subscription/login/code')) return connected;
      return {};
    });
    renderPage();
    const card = within(await screen.findByRole('region', { name: 'Langganan Claude' }));
    fireEvent.click(card.getByRole('button', { name: /Hubungkan/ }));
    const dialog = within(await screen.findByRole('dialog'));

    // Bawaannya tanpa terminal: tidak ada perintah yang harus dijalankan.
    expect(dialog.queryByText(/claude setup-token/)).toBeNull();
    expect(dialog.getByText(/Help improve Claude/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Buat tautan login' }));

    const link = (await dialog.findByRole('link', { name: /Buka halaman login Claude/ })) as HTMLAnchorElement;
    expect(link.href).toBe('https://claude.ai/oauth/authorize?abc123');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noreferrer');

    fireEvent.change(dialog.getByLabelText('Tempel kodenya di sini'), { target: { value: '  kode-dari-claude-123#state\n' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Hubungkan' }));
    await waitFor(() => expect(api.sent('POST').some(([url]) => url.endsWith('/login/code'))).toBe(true));
    const [, init] = api.sent('POST').find(([url]) => url.endsWith('/login/code'))!;
    expect(JSON.parse(init!.body as string)).toEqual({ code: 'kode-dari-claude-123#state' });

    // Kartu memakai jawaban server; dialog tertutup dan sesi login yang sudah selesai tidak dibatalkan lagi.
    expect(await card.findByText('•••• QwEr')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sent('DELETE')).toHaveLength(0);
  });

  it('keeps pasting a token as a second way, and cancels an unfinished sign-in when the page goes away', async () => {
    const api = mockFetch(dto(), (url) =>
      url.endsWith('/subscription/login') ? { url: 'https://claude.ai/oauth/authorize?xyz', expiresAt: '2026-11-26T01:00:00.000Z' } : { ok: true },
    );
    const view = renderPage();
    const card = within(await screen.findByRole('region', { name: 'Langganan Claude' }));
    fireEvent.click(card.getByRole('button', { name: /Ganti/ }));
    const dialog = within(await screen.findByRole('dialog'));

    fireEvent.click(dialog.getByRole('button', { name: /Sudah punya token/ }));
    expect(dialog.getByText(/claude setup-token/)).toBeTruthy();
    expect((dialog.getByLabelText('Token langganan') as HTMLInputElement).type).toBe('password');

    fireEvent.click(dialog.getByRole('button', { name: 'Masuk lewat tautan saja' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Buat tautan login' }));
    await dialog.findByRole('link', { name: /Buka halaman login Claude/ });
    expect(api.sent('DELETE')).toHaveLength(0);

    view.unmount();
    expect(api.sent('DELETE').map(([url]) => url)).toEqual(['/api/assistant/credentials/subscription/login']);
  });

  it('sends a new credential to its own connection and never to the wrong one', async () => {
    const connected = dto({
      providers: dto().providers.map((p) =>
        p.provider === 'api' ? { ...p, connected: true, last4: 'Wx1Z' } : p,
      ),
    });
    const api = mockFetch(dto(), () => connected);
    renderPage();
    const apiCard = within(await screen.findByRole('region', { name: 'API Claude' }));

    fireEvent.click(apiCard.getByRole('button', { name: /Hubungkan/ }));
    const dialog = within(await screen.findByRole('dialog'));
    const secret = dialog.getByLabelText('Kunci API') as HTMLInputElement;
    expect(secret.type).toBe('password');

    // Token langganan ditempel ke jalur API: ditolak di browser.
    fireEvent.change(secret, { target: { value: `sk-ant-oat01-${'a'.repeat(40)}` } });
    fireEvent.click(dialog.getByRole('button', { name: 'Hubungkan' }));
    expect(dialog.getByText(/Ini token langganan, bukan kunci api/i)).toBeTruthy();
    expect(api.sent('PUT')).toHaveLength(0);

    const key = `sk-ant-api03-${'b'.repeat(40)}`;
    fireEvent.change(secret, { target: { value: `  ${key}\n` } });
    fireEvent.click(dialog.getByRole('button', { name: 'Hubungkan' }));
    await waitFor(() => expect(api.sent('PUT')).toHaveLength(1));
    const [url, init] = api.sent('PUT')[0]!;
    expect(url).toBe('/api/assistant/credentials/api');
    expect(JSON.parse(init!.body as string)).toEqual({ secret: key });

    // Kartu memakai jawaban server: terhubung, hanya empat karakter terakhir yang tampil.
    expect(await apiCard.findByText('•••• Wx1Z')).toBeTruthy();
    expect(screen.queryByText(new RegExp(key))).toBeNull();
  });

  it('shows usage for the current month', async () => {
    const api = mockFetch(dto());
    renderPage();

    expect(await screen.findByText('1.234')).toBeTruthy();
    expect(api.calls().some(([url]) => url === `/api/assistant/usage?month=${currentMonthWib()}`)).toBe(true);
    expect(screen.getByText('$3.46')).toBeTruthy();
    expect(screen.getByText('1.000 panggilan · $0.00 · 2 gagal')).toBeTruthy();
    const purposes = within(screen.getByText('Per keperluan').parentElement!).getAllByRole('listitem');
    expect(purposes.map((li) => li.textContent)).toEqual([
      'Deteksi awal900 panggilan · $0.40',
      'Rekomendasi jawaban334 panggilan · $3.06',
    ]);
    const topics = within(
      screen.getByText('Topik yang paling sering ditanyakan').parentElement!,
    ).getAllByRole('listitem');
    expect(topics.map((li) => li.textContent)).toEqual(['1.Lapor SPT Tahunan34', '2.Aktivasi EFIN21']);
  });

  it('asks the playground and shows the draft, sources, and who answered', async () => {
    const answer: AosPlaygroundDTO = {
      text: '<draf>Selamat siang. *EFIN* diaktivasi di kantor.</draf><catatan>Cek identitas dulu.</catatan><keyakinan>tinggi</keyakinan>',
      answer: {
        draft: 'Selamat siang. *EFIN* diaktivasi di kantor.',
        notes: 'Cek identitas dulu.',
        confidence: 'tinggi',
        sources: [
          { type: 'library', title: 'SOP EFIN', documentId: '12', page: 3 },
          { type: 'web', title: 'pajak.go.id', url: 'https://pajak.go.id/efin' },
        ],
      },
      provider: 'subscription',
      model: 'claude-opus-5-5',
      durationMs: 12_300,
    };
    const api = mockFetch(dto(), () => answer);
    renderPage();
    await screen.findByRole('region', { name: 'API Claude' });

    fireEvent.change(screen.getByLabelText('Pertanyaan untuk AOS'), {
      target: { value: ' Cara aktivasi EFIN? ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Tanya/ }));

    const result = within(await screen.findByRole('region', { name: 'Jawaban AOS' }));
    const [url, init] = api.sent('POST')[0]!;
    expect(url).toBe('/api/assistant/playground');
    expect(JSON.parse(init!.body as string)).toEqual({ text: 'Cara aktivasi EFIN?' });
    expect(result.getByText('EFIN').tagName).toBe('STRONG');
    expect(result.getByText('Cek identitas dulu.')).toBeTruthy();
    expect(result.getByText('Keyakinan tinggi')).toBeTruthy();
    expect(result.getByRole('link', { name: /SOP EFIN · hlm 3/ }).getAttribute('href')).toBe(
      '/pustaka?doc=12',
    );
    expect(result.getByRole('link', { name: /pajak\.go\.id/ }).getAttribute('href')).toBe(
      'https://pajak.go.id/efin',
    );
    expect(result.getByText('Langganan · Claude Opus 5.5 · 12,3 dtk')).toBeTruthy();
  });
});

describe('assistant settings helpers', () => {
  it('always lists both connections once, main first', () => {
    expect(fullOrder(['api'])).toEqual(['api', 'subscription']);
    expect(fullOrder(['subscription', 'subscription'])).toEqual(['subscription', 'api']);
  });

  it('validates with the shared schema and explains problems in Indonesian', () => {
    expect(checkSettings(settings)).toEqual({ data: settings, problems: [] });
    const bad = checkSettings({
      ...settings,
      privacy: { ...settings.privacy, contextMessages: 2 },
      budget: { monthlyUsd: -1 },
    });
    expect(bad.data).toBeNull();
    expect(bad.problems).toEqual([
      'Jumlah pesan yang dibaca: isi bilangan bulat 5 sampai 100.',
      'Anggaran bulanan: isi angka 0 sampai 100.000.',
    ]);
  });

  it('cleans up a pasted address into a site name', () => {
    expect(cleanDomain(' https://www.Pajak.go.id/id/peraturan?x=1 ')).toEqual({
      ok: true,
      value: 'www.pajak.go.id',
    });
    expect(cleanDomain('ortax.org')).toEqual({ ok: true, value: 'ortax.org' });
    expect(cleanDomain('pajak')).toMatchObject({ ok: false });
    expect(cleanDomain('-x.go.id')).toMatchObject({ ok: false });
  });

  it('formats cost in USD with two decimals', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });

  it('takes the current month in WIB, not in UTC', () => {
    // 30 Nov 2026 18:30 UTC = 1 Des 2026 01:30 WIB.
    expect(currentMonthWib(new Date('2026-11-30T18:30:00.000Z'))).toBe('2026-12');
  });
});
