import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { AosThreadDTO, AssistantStatusDTO, ConversationDTO } from '@wa/shared';
import type { ComposerHandle } from '@/features/chats/Composer';
import { setPrefs } from '@/lib/theme';
import { AosDock } from './AosDock';
import { clearAosLive, setAosLive } from './live';
import { aosKeys } from './queries';
import { aosMessage, aosThread, DRAFT, draftAnswer, offerMessage } from './test-fixtures';

// Menggambar PNG butuh kanvas sungguhan; di test cukup dipastikan hasilnya sampai ke kotak balas.
vi.mock('./infographic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./infographic')>()),
  infographicPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
}));

const conversation: ConversationDTO = {
  id: '1',
  contact: { id: 'c1', waId: '6281200000001', name: 'Bu Sari', profileName: null, displayName: 'Bu Sari', firstSeenAt: '2026-11-01T00:00:00.000Z' },
  lastMessageAt: null,
  lastMessagePreview: null,
  lastMessageDirection: null,
  lastInboundAt: null,
  cswExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  unreadCount: 0,
  labels: [],
  aosOffer: false,
};

const READY: AssistantStatusDTO = { ready: true, mode: 'offer' };

type FetchCall = [string, RequestInit | undefined];
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const posts = () => (fetchMock.mock.calls as FetchCall[]).map(([url, init]) => [url, init?.body ? JSON.parse(init.body as string) : undefined]);
/** Mutasi memanggil server sesaat setelah tombol ditekan, bukan pada saat itu juga. */
const posted = (expected: unknown[]) => waitFor(() => expect(posts()).toEqual(expected));

function composerStub(hasText = false) {
  return { addFiles: vi.fn(), insertText: vi.fn(), hasText: vi.fn(() => hasText) } satisfies ComposerHandle;
}

function setup(thread: AosThreadDTO | null, { status = READY, composer = composerStub() } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(aosKeys.status, status);
  if (thread) qc.setQueryData(aosKeys.thread('1'), thread);
  const ui = (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AosDock conversation={conversation} composerRef={{ current: composer }} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(ui);
  return { qc, composer, view, remount: () => (view.unmount(), render(ui)) };
}

const panel = () => screen.queryByRole('complementary', { name: 'Asisten OSing' });
const openPanel = () => fireEvent.click(screen.getByRole('button', { name: 'Buka AOS' }));

beforeEach(() => {
  fetchMock = vi.fn(() => json({}));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setPrefs({ aosAutoOpen: true, aosWide: false });
});

describe('AosDock: when it shows', () => {
  it('renders nothing while the assistant is not ready', () => {
    const { view } = setup(aosThread([offerMessage('100')], { openOfferId: '100' }), { status: { ready: false, mode: 'offer' } });
    expect(view.container.innerHTML).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens by itself when the thread has an open offer', () => {
    setup(aosThread([offerMessage('101')], { openOfferId: '101' }));
    const aos = within(panel()!);
    expect(aos.getByText('Sesi untuk +62 812-0000-0001 · Bu Sari')).toBeTruthy();
    expect(aos.getByText('EFIN yang lupa').tagName).toBe('STRONG');
    expect(aos.getByRole('button', { name: 'Buatkan rekomendasi jawaban' }).getAttribute('data-primary')).toBe('true');
    // Panel yang terbuka sendiri tidak merebut kursor dari kotak balas WhatsApp.
    expect(document.activeElement).toBe(document.body);
  });

  it('does not open again for the same offer once it was closed', () => {
    const { remount } = setup(aosThread([offerMessage('102')], { openOfferId: '102' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kecilkan' }));
    expect(panel()).toBeNull();
    expect(screen.getByText('AOS punya tawaran')).toBeTruthy();

    // Pindah chat lalu kembali: tawaran yang sama tidak membuka panel lagi.
    remount();
    expect(panel()).toBeNull();
  });

  it('opens for a newer offer that arrives while the panel is closed', async () => {
    const { qc } = setup(aosThread([offerMessage('103')], { openOfferId: '103' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kecilkan' }));
    act(() => {
      qc.setQueryData(aosKeys.thread('1'), aosThread([offerMessage('103', { offerState: 'dismissed' }), offerMessage('104')], { openOfferId: '104' }));
    });
    // TanStack Query mengabari komponen lewat antrean, jadi panel muncul sesaat kemudian.
    await waitFor(() => expect(panel()).not.toBeNull());
  });

  it('waits for the launcher when opening by itself is switched off', () => {
    setPrefs({ aosAutoOpen: false });
    setup(aosThread([offerMessage('105')], { openOfferId: '105' }));
    expect(panel()).toBeNull();
    expect(screen.getByText('AOS punya tawaran')).toBeTruthy();

    openPanel();
    expect(panel()).not.toBeNull();
    expect(screen.queryByText('AOS punya tawaran')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Pertanyaan untuk AOS'));
    fireEvent.click(screen.getByRole('button', { name: 'Tutup AOS' }));
    expect(panel()).toBeNull();
  });

  it('remembers the wide size in the per-browser prefs', () => {
    setup(aosThread([]));
    openPanel();
    expect(panel()!.getAttribute('data-wide')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Lebarkan' }));
    expect(panel()!.getAttribute('data-wide')).toBe('true');
    expect(JSON.parse(localStorage.getItem('wa-inbox-prefs')!)).toMatchObject({ aosWide: true });
    expect(screen.getByRole('button', { name: 'Sempitkan' })).toBeTruthy();
  });
});

describe('AosDock: offers and questions', () => {
  it('sends the chosen option and shows the messages the server created', async () => {
    const offer = offerMessage('110');
    const created = [
      { ...offer, offerState: 'answered' as const },
      aosMessage({ id: '111', kind: 'user', text: 'Buatkan rekomendasi jawaban', author: { id: '1', name: 'Dewi' } }),
      aosMessage({ id: '112', kind: 'answer', status: 'pending' }),
    ];
    fetchMock.mockImplementation(() => json({ messages: created }, 202));
    const { qc } = setup(aosThread([offer], { openOfferId: '110' }));

    fireEvent.click(screen.getByRole('button', { name: 'Buatkan rekomendasi jawaban' }));
    await posted([['/api/conversations/1/assistant/messages', { offerId: '110', optionIndex: 0 }]]);

    expect(await screen.findByText('Dewi')).toBeTruthy();
    expect(screen.getByText('Menyiapkan jawaban…')).toBeTruthy();
    // Tawaran yang sudah dijawab tidak bisa ditekan lagi.
    expect((screen.getByRole('button', { name: 'Syarat dan data yang perlu diminta ke WP' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Tidak perlu' })).toBeNull();
    expect(qc.getQueryData<AosThreadDTO>(aosKeys.thread('1'))).toMatchObject({ openOfferId: null, messages: [{ id: '110' }, { id: '111' }, { id: '112' }] });
  });

  it('dismisses an offer with "Tidak perlu"', async () => {
    const offer = offerMessage('113');
    fetchMock.mockImplementation(() => json({ message: { ...offer, offerState: 'dismissed' } }));
    setup(aosThread([offer], { openOfferId: '113' }));

    fireEvent.click(screen.getByRole('button', { name: 'Tidak perlu' }));
    await posted([['/api/assistant/messages/113/dismiss', undefined]]);
    expect(await screen.findByText('Tawaran ditutup')).toBeTruthy();
  });

  it('sends a typed question on Enter, keeps Shift+Enter for a new line, and blocks a second send while waiting', async () => {
    let respond!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (respond = resolve)));
    setup(aosThread([]));
    openPanel();
    const box = screen.getByLabelText('Pertanyaan untuk AOS') as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: '  Kalau WP di luar kota, bisa diwakilkan?  ' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: 'Enter' });
    await posted([['/api/conversations/1/assistant/messages', { text: 'Kalau WP di luar kota, bisa diwakilkan?' }]]);

    await waitFor(() => expect((screen.getByRole('button', { name: 'Kirim pertanyaan ke AOS' }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Ringkas chat ini' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => respond(new Response(JSON.stringify({ messages: [aosMessage({ id: '120', kind: 'user', text: 'Kalau WP di luar kota, bisa diwakilkan?' })] }), { status: 202 })));
    await waitFor(() => expect(box.value).toBe(''));
    expect(screen.getByText('Kalau WP di luar kota, bisa diwakilkan?')).toBeTruthy();
  });

  it('asks for a summary and an explanation from the quick chips', async () => {
    fetchMock.mockImplementation(() => json({ messages: [] }, 202));
    setup(aosThread([]));
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Ringkas chat ini' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Jelaskan maksud pesan' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Jelaskan maksud pesan' }));
    await waitFor(() => expect(posts().map(([, body]) => body)).toEqual([{ action: 'summarize' }, { action: 'explain' }]));
  });

  it('keeps the question in the box when the server refuses it', async () => {
    fetchMock.mockImplementation(() => json({ error: { code: 'aos_unavailable', message: 'AOS sedang tidak tersedia.' } }, 503));
    setup(aosThread([]));
    openPanel();
    const box = screen.getByLabelText('Pertanyaan untuk AOS') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Apa itu EFIN?' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() => expect((screen.getByRole('button', { name: 'Kirim pertanyaan ke AOS' }) as HTMLButtonElement).disabled).toBe(false));
    expect(box.value).toBe('Apa itu EFIN?');
  });
});

describe('AosDock: answers', () => {
  it('renders streaming text from the delta store in a running answer', () => {
    setup(aosThread([aosMessage({ id: '130', kind: 'answer', status: 'running', steps: ['Membaca chat…'] })]));
    openPanel();
    expect(screen.getByText('Membaca chat…')).toBeTruthy();
    expect(screen.queryByText('Draf balasan')).toBeNull();

    // Bagian <draf> belum ditutup dan tanda berikutnya baru separuh tertulis: drafnya tetap tampil, tandanya tidak.
    act(() => setAosLive('130', { text: '<draf>Selamat pagi, *Ibu*. Untuk lupa EFIN</dr', steps: ['Membaca chat…', 'Mencari di Pustaka…'] }));
    expect(screen.getByText('Draf balasan')).toBeTruthy();
    expect(screen.getByText('Ibu').tagName).toBe('STRONG');
    expect(screen.getByText(/Untuk lupa EFIN$/)).toBeTruthy();
    expect(screen.getByText('Mencari di Pustaka…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pakai' })).toBeNull();

    act(() => setAosLive('130', { text: '<draf>Selamat pagi.</draf><catatan>- Cek identitas', steps: [] }));
    expect(screen.getByText('Selamat pagi.')).toBeTruthy();
    expect(screen.getByText('Cek identitas')).toBeTruthy();
    act(() => clearAosLive('130'));
  });

  it('cancels a running answer', async () => {
    const running = aosMessage({ id: '131', kind: 'answer', status: 'running' });
    fetchMock.mockImplementation(() => json({ message: { ...running, status: 'cancelled' } }));
    setup(aosThread([running]));
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Batalkan' }));
    await posted([['/api/assistant/messages/131/cancel', undefined]]);
    expect(await screen.findByText('Permintaan dibatalkan.')).toBeTruthy();
  });

  it('shows the draft, notes, sources, confidence and meta of a finished answer', () => {
    setup(aosThread([draftAnswer('140')]));
    openPanel();

    expect(screen.getByText('lupa EFIN').tagName).toBe('STRONG');
    expect(screen.getByText('Verifikasi identitas dulu.').closest('li')).not.toBeNull();
    expect(screen.getByText('Keyakinan tinggi')).toBeTruthy();
    expect(screen.getByText('Langganan · Opus 5.5 · 14 dtk')).toBeTruthy();

    const library = screen.getByRole('link', { name: 'Pustaka · Panduan Layanan EFIN.pdf · hlm. 3' });
    expect(library.getAttribute('href')).toBe('/pustaka?doc=7');
    const web = screen.getByRole('link', { name: 'pajak.go.id' });
    expect(web.getAttribute('href')).toBe('https://www.pajak.go.id/id/lupa-efin');
    expect(web.getAttribute('target')).toBe('_blank');
    expect(web.getAttribute('rel')).toBe('noreferrer');
  });

  it('warns to check a low-confidence answer first', () => {
    const answer = draftAnswer('141');
    setup(aosThread([{ ...answer, answer: { ...answer.answer!, confidence: 'rendah', sources: [] } }]));
    openPanel();
    expect(screen.getByText('Keyakinan rendah · cek dulu sebelum dikirim')).toBeTruthy();
  });

  it('shows an answer without a draft as plain text, with the same buttons as a draft', () => {
    const text = 'WP menanyakan cara mendapatkan kembali EFIN.';
    const { composer } = setup(aosThread([aosMessage({ id: '142', kind: 'answer', text, answer: { draft: null, notes: null, confidence: null, sources: [] } })]));
    openPanel();
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText('Draf balasan')).toBeNull();
    for (const name of ['Salin', 'Perpendek', 'Lebih ramah', 'Buat ulang']) expect(screen.getByRole('button', { name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pakai' }));
    expect(composer.insertText).toHaveBeenCalledExactlyOnceWith(text, 'replace');
  });

  it('splits a long answer into parts that each fit one WhatsApp message, to be sent in order', async () => {
    const para = (n: number) => `Bagian isi ${n}. ` + 'Wajib pajak orang pribadi menyampaikan SPT Tahunan paling lambat akhir Maret. '.repeat(12);
    const long = [1, 2, 3, 4, 5, 6].map(para).join('\n\n');
    expect(long.length).toBeGreaterThan(4096);
    const { composer } = setup(aosThread([aosMessage({ id: '144', kind: 'answer', text: long, answer: { draft: null, notes: null, confidence: null, sources: [] } })]));
    openPanel();
    expect(screen.getByText(/dibagi 2 bagian\. Kirim berurutan/)).toBeTruthy();
    expect(screen.getByText('Draf balasan · bagian 1 dari 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pakai bagian 2' }));
    const [sent] = composer.insertText.mock.calls[0]!;
    expect(sent.length).toBeLessThanOrEqual(4000);
    expect(sent.startsWith('Bagian isi')).toBe(true);
    // Satu set tombol perbaikan untuk seluruh jawaban.
    expect(screen.getAllByRole('button', { name: 'Perpendek' })).toHaveLength(1);
  });

  it('shows an infographic in a sandbox and attaches it to the reply as a picture', async () => {
    const html = '<!doctype html><html><head><style>body{background:#212C5F}</style></head><body><h1>Lapor SPT</h1></body></html>';
    const { composer } = setup(
      aosThread([aosMessage({ id: '145', kind: 'answer', text: `<infografis>${html}</infografis>Infografis siap.`, answer: { draft: null, notes: null, confidence: null, sources: [], infographic: html } })]),
    );
    openPanel();
    const frame = screen.getByTitle('Infografis AOS') as HTMLIFrameElement;
    // Tanpa izin skrip: dokumen buatan model tidak bisa menjalankan apa pun.
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Lapor SPT</h1>');
    fireEvent.click(screen.getByRole('button', { name: /Lampirkan ke balasan/ }));
    await waitFor(() => expect(composer.addFiles).toHaveBeenCalledTimes(1));
    const [[file]] = composer.addFiles.mock.calls[0]! as [[File]];
    expect(file.type).toBe('image/png');
    expect(file.name).toMatch(/^infografis-aos-\d{8}-\d{4}\.png$/);
  });

  it('asks AOS for an infographic from the quick chip or from an answer', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    setup(aosThread([draftAnswer('146')]));
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Buat infografis' }));
    await posted([['/api/conversations/1/assistant/messages', { action: 'infographic' }]]);
  });

  it('shows an error message in its own bubble', () => {
    setup(aosThread([aosMessage({ id: '143', kind: 'error', status: 'error', error: 'Batas pemakaian AOS tercapai.' })]));
    openPanel();
    expect(screen.getByText('Batas pemakaian AOS tercapai.').closest('[data-tone="error"]')).not.toBeNull();
  });

  it('"Pakai" hands the draft to the reply box and records that it was used', async () => {
    const answer = draftAnswer('150');
    fetchMock.mockImplementation(() => json({ message: { ...answer, usedAt: '2026-11-25T01:05:00.000Z' } }));
    const { composer } = setup(aosThread([answer]));
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Pakai' }));
    expect(composer.insertText).toHaveBeenCalledExactlyOnceWith(DRAFT, 'replace');
    await posted([['/api/assistant/messages/150/used', undefined]]);
    expect(await screen.findByText('✓ Dipakai')).toBeTruthy();
  });

  it('asks whether to replace or add when the reply box already has text', () => {
    const { composer } = setup(aosThread([draftAnswer('151')]), { composer: composerStub(true) });
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Pakai' }));
    expect(composer.insertText).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(composer.insertText).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Tambahkan' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Pakai' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tambahkan' }));
    expect(composer.insertText).toHaveBeenCalledExactlyOnceWith(DRAFT, 'append');

    fireEvent.click(screen.getByRole('button', { name: 'Pakai' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ganti' }));
    expect(composer.insertText).toHaveBeenLastCalledWith(DRAFT, 'replace');
  });

  it('asks for a rework of that answer', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    setup(aosThread([draftAnswer('152')]));
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Perpendek' }));
    await posted([['/api/conversations/1/assistant/messages', { action: 'shorten', targetId: '152' }]]);
  });

  it('sends feedback, and null when the active thumb is pressed again', async () => {
    const answer = draftAnswer('153');
    fetchMock.mockImplementation((_url, init) => {
      const { value } = JSON.parse(init!.body as string) as { value: 1 | -1 | null };
      return json({ message: { ...answer, feedback: value } });
    });
    setup(aosThread([answer]));
    openPanel();
    const up = () => screen.getByRole('button', { name: 'Jawaban ini membantu' });

    fireEvent.click(up());
    await waitFor(() => expect(up().getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(up());
    await waitFor(() => expect(up().getAttribute('aria-pressed')).toBe('false'));
    await posted([
      ['/api/assistant/messages/153/feedback', { value: 1 }],
      ['/api/assistant/messages/153/feedback', { value: null }],
    ]);
  });
});

describe('AosDock: topics', () => {
  it('starts a new topic after confirmation and hides the earlier session behind a button', async () => {
    const old = aosMessage({ id: '160', kind: 'user', text: 'Pertanyaan lama', createdAt: '2026-11-25T01:00:00.000Z' });
    fetchMock.mockImplementation(() => json(aosThread([old], { topicStartedAt: '2026-11-25T02:00:00.000Z' })));
    const ask = vi.fn(() => false);
    vi.stubGlobal('confirm', ask);
    setup(aosThread([old]));
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Topik baru' }));
    expect(fetchMock).not.toHaveBeenCalled();

    ask.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Topik baru' }));
    await posted([['/api/conversations/1/assistant/reset', undefined]]);

    expect(await screen.findByText(/^Topik baru sejak /)).toBeTruthy();
    expect(screen.queryByText('Pertanyaan lama')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tampilkan sesi sebelumnya' }));
    expect(screen.getByText('Pertanyaan lama')).toBeTruthy();
  });
});
