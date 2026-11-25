import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { KbDocumentDTO, KbListDTO } from '@wa/shared';
import { addTags, checkFile, isExpired, splitTags } from './helpers';
import { KnowledgePage } from './KnowledgePage';

const MB = 1024 * 1024;

const doc = (over: Partial<KbDocumentDTO> = {}): KbDocumentDTO => ({
  id: '1',
  kind: 'file',
  title: 'PER-02 Pelaporan SPT',
  description: null,
  tags: ['spt'],
  fileName: 'per-02.pdf',
  mimeType: 'application/pdf',
  fileSize: 1.5 * MB,
  status: 'ready',
  error: null,
  pageCount: 12,
  charCount: 20_000,
  summary: 'Tata cara pelaporan SPT Tahunan.',
  isActive: true,
  isOfficial: true,
  validUntil: null,
  uploadedBy: { id: '7', name: 'Bu Rina' },
  createdAt: '2026-11-20T03:00:00.000Z',
  deletedAt: null,
  deletedBy: null,
  fileUrl: '/api/knowledge/1/file',
  ...over,
});

const list = (documents: KbDocumentDTO[]): KbListDTO => ({
  documents,
  tags: [...new Set(documents.flatMap((d) => d.tags))],
  totalBytes: 1.5 * MB,
  quotaBytes: 1024 * MB,
});

type Call = [string, RequestInit | undefined];

/** fetch tiruan: `respond` menerima alamat dan init, mengembalikan isi JSON jawaban. */
function mockFetch(respond: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      new Response(JSON.stringify(respond(String(input), init)), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const calls = () => fetchMock.mock.calls as unknown as Call[];
  return {
    calls,
    sent: (method: string) => calls().filter(([, init]) => (init?.method ?? 'GET') === method),
  };
}

function renderPage(path = '/pustaka') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <KnowledgePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fileInput = () => screen.getByLabelText('Pilih berkas untuk diunggah');
const file = (name: string, size?: number) => {
  const f = new File(['isi'], name);
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
  return f;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('KnowledgePage', () => {
  it('shows the documents from the server and the taxpayer-data warning', async () => {
    const api = mockFetch(() =>
      list([
        doc(),
        doc({
          id: '2',
          kind: 'note',
          title: 'Alur aktivasi EFIN',
          tags: ['efin'],
          fileUrl: null,
          fileSize: null,
          pageCount: null,
          isOfficial: false,
          status: 'processing',
          summary: null,
        }),
        doc({
          id: '3',
          title: 'Pindaian buram',
          tags: [],
          isOfficial: false,
          status: 'failed',
          error: 'Teks tidak terbaca.',
          summary: null,
          validUntil: '2020-01-31',
        }),
      ]),
    );
    renderPage();

    const official = within(await screen.findByRole('article', { name: 'PER-02 Pelaporan SPT' }));
    expect(screen.getByText('Jangan unggah dokumen yang memuat data Wajib Pajak.')).toBeTruthy();
    expect(official.getByText('Siap')).toBeTruthy();
    expect(official.getByText('Sumber resmi')).toBeTruthy();
    expect(official.getByText('Tata cara pelaporan SPT Tahunan.')).toBeTruthy();
    expect(official.getByText(/Bu Rina · .* · 1,5 MB · 12 hlm/)).toBeTruthy();

    expect(
      within(screen.getByRole('article', { name: 'Alur aktivasi EFIN' })).getByText('Diproses'),
    ).toBeTruthy();

    const failed = within(screen.getByRole('article', { name: 'Pindaian buram' }));
    expect(failed.getByText('Gagal')).toBeTruthy();
    expect(failed.getByText('Teks tidak terbaca.')).toBeTruthy();
    expect(failed.getByRole('button', { name: /Proses ulang/ })).toBeTruthy();
    expect(failed.getByText('Kedaluwarsa 31 Jan 2020').className).toContain('text-destructive');

    expect(screen.getByText('1,5 MB dari 1.024 MB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'efin' })).toBeTruthy();
    expect(api.calls()[0]![0]).toBe('/api/knowledge');
  });

  it('refuses a file type that cannot be read, without sending it', async () => {
    const api = mockFetch(() => list([]));
    renderPage();
    await screen.findByText('Pustaka masih kosong');

    fireEvent.change(fileInput(), {
      target: { files: [file('daftar-wp.exe'), file('rekaman.pdf', 26 * MB)] },
    });

    expect(await screen.findByText(/Jenis berkas \.exe tidak didukung/)).toBeTruthy();
    expect(screen.getByText(/melebihi batas 25 MB per berkas/)).toBeTruthy();
    expect(api.sent('POST')).toHaveLength(0);
  });

  it('uploads accepted files one at a time as multipart field "file"', async () => {
    const api = mockFetch((_url, init) =>
      init?.method === 'POST' ? { document: doc({ id: '9', status: 'processing' }) } : list([]),
    );
    renderPage();
    await screen.findByText('Pustaka masih kosong');

    fireEvent.change(fileInput(), { target: { files: [file('se-05.pdf'), file('faq.docx')] } });

    await waitFor(() => expect(screen.getAllByText('Terunggah, sedang diproses')).toHaveLength(2));
    const posts = api.sent('POST');
    expect(posts.map(([url]) => url)).toEqual(['/api/knowledge', '/api/knowledge']);
    expect(posts.map(([, init]) => ((init!.body as FormData).get('file') as File).name)).toEqual([
      'se-05.pdf',
      'faq.docx',
    ]);
  });

  it('reloads the list every 5 seconds only while a document is still being processed', async () => {
    vi.useFakeTimers();
    let status: KbDocumentDTO['status'] = 'processing';
    const api = mockFetch(() => list([doc({ status })]));
    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    renderPage();
    await advance(0);
    expect(api.sent('GET')).toHaveLength(1);

    await advance(5_000);
    expect(api.sent('GET')).toHaveLength(2);

    status = 'ready';
    await advance(5_000);
    expect(api.sent('GET')).toHaveLength(3);
    // Beri waktu jawaban terakhir sampai ke layar.
    await advance(50);
    expect(screen.getByText('Siap')).toBeTruthy();

    await advance(60_000);
    expect(api.sent('GET')).toHaveLength(3);
  });

  it('opens the trash and restores a document', async () => {
    const deleted = doc({
      id: '5',
      title: 'SOP lama',
      deletedAt: '2026-11-22T04:00:00.000Z',
      deletedBy: { id: '8', name: 'Pak Adi' },
    });
    const api = mockFetch((url, init) =>
      init?.method === 'POST' ? { document: deleted } : list(url.includes('trash=1') ? [deleted] : [doc()]),
    );
    renderPage();
    await screen.findByRole('article', { name: 'PER-02 Pelaporan SPT' });

    fireEvent.click(screen.getByRole('button', { name: /Tempat sampah/ }));
    const row = within(await screen.findByRole('article', { name: 'SOP lama' }));
    expect(row.getByText(/Dihapus oleh Pak Adi/)).toBeTruthy();
    expect(api.calls().some(([url]) => url === '/api/knowledge?trash=1')).toBe(true);

    fireEvent.click(row.getByRole('button', { name: /Pulihkan/ }));
    await waitFor(() => expect(api.sent('POST').map(([url]) => url)).toEqual(['/api/knowledge/5/restore']));
  });

  it('scrolls to and highlights the document named in ?doc=', async () => {
    // jsdom tidak punya scrollIntoView.
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      mockFetch(() => list([doc(), doc({ id: '2', title: 'Alur aktivasi EFIN' })]));
      renderPage('/pustaka?doc=2');

      const target = await screen.findByRole('article', { name: 'Alur aktivasi EFIN' });
      await waitFor(() => expect(target.className).toContain('ring-gold'));
      expect(scrollIntoView.mock.contexts[0]).toBe(target);
      expect(screen.getByRole('article', { name: 'PER-02 Pelaporan SPT' }).className).not.toContain(
        'ring-gold',
      );
    } finally {
      if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('saves a note with its comma-separated tags', async () => {
    const api = mockFetch((_url, init) =>
      init?.method === 'POST' ? { document: doc({ id: '4', kind: 'note' }) } : list([]),
    );
    renderPage();
    await screen.findByText('Pustaka masih kosong');

    fireEvent.click(screen.getByRole('button', { name: /Tulis catatan/ }));
    fireEvent.change(screen.getByLabelText('Judul'), { target: { value: 'Syarat EFIN' } });
    fireEvent.change(screen.getByLabelText('Isi catatan'), { target: { value: 'Bawa KTP dan NPWP.' } });
    fireEvent.change(screen.getByLabelText('Tag (opsional)'), { target: { value: 'efin, aktivasi,' } });
    fireEvent.change(screen.getByLabelText('Tag (opsional)'), { target: { value: 'layanan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan catatan' }));

    await waitFor(() => expect(api.sent('POST')).toHaveLength(1));
    const [url, init] = api.sent('POST')[0]!;
    expect(url).toBe('/api/knowledge/notes');
    expect(JSON.parse(init!.body as string)).toEqual({
      title: 'Syarat EFIN',
      text: 'Bawa KTP dan NPWP.',
      tags: ['efin', 'aktivasi', 'layanan'],
    });
  });
});

describe('knowledge helpers', () => {
  it('accepts readable file types up to the size limit', () => {
    expect(checkFile({ name: 'Peraturan.PDF', size: 25 * MB })).toBeNull();
    expect(checkFile({ name: 'foto.jpeg', size: 1 })).toBeNull();
    expect(checkFile({ name: 'tanpa-ekstensi', size: 10 })).toMatch(/tidak didukung/);
    expect(checkFile({ name: 'arsip.zip', size: 10 })).toMatch(/\.zip tidak didukung/);
    expect(checkFile({ name: 'besar.pdf', size: 25 * MB + 1 })).toMatch(/melebihi batas 25 MB/);
    expect(checkFile({ name: 'kosong.txt', size: 0 })).toBe('Berkas kosong.');
  });

  it('treats a document as expired only after its last valid day', () => {
    expect(isExpired(null, '2026-11-25')).toBe(false);
    expect(isExpired('2026-11-25', '2026-11-25')).toBe(false);
    expect(isExpired('2026-11-24', '2026-11-25')).toBe(true);
  });

  it('splits and merges tags without duplicates, up to ten', () => {
    expect(splitTags(' spt , ,npwp\nefin ')).toEqual(['spt', 'npwp', 'efin']);
    expect(addTags(['SPT'], ['spt', 'npwp'])).toEqual(['SPT', 'npwp']);
    expect(
      addTags(
        [],
        Array.from({ length: 12 }, (_, i) => `t${i}`),
      ),
    ).toHaveLength(10);
  });
});
