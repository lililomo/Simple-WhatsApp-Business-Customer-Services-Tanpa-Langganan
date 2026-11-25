import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ConversationDTO, UserDTO } from '@wa/shared';
import { libraryKeys } from '@/features/library/queries';
import { ChatPane } from './ChatPane';
import { keys } from './queries';

// Linimasa (react-virtuoso) tidak diuji di sini dan butuh ukuran layout yang tidak ada di jsdom.
vi.mock('./MessageTimeline', () => ({ MessageTimeline: () => null }));

const conversation = (id: string, name: string): ConversationDTO => ({
  id,
  contact: {
    id: `c${id}`,
    waId: `62812000000${id}`,
    name,
    profileName: null,
    displayName: name,
    firstSeenAt: '2026-11-01T00:00:00.000Z',
  },
  lastMessageAt: null,
  lastMessagePreview: null,
  lastMessageDirection: null,
  lastInboundAt: null,
  cswExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  unreadCount: 0,
  labels: [],
});

const me: UserDTO = {
  id: '1',
  name: 'Petugas Uji',
  email: null,
  nip: '000000001',
  seksi: 'Pelayanan',
  authSource: 'portal',
  role: 'agent',
  isActive: true,
  lastLoginAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

/** Dua percakapan yang sudah ada di cache, seperti saat petugas berpindah di antara chat yang pernah dibuka. */
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(keys.conversation('1'), conversation('1', 'Bu Sari'));
  qc.setQueryData(keys.conversation('2'), conversation('2', 'Pak Anwar'));
  qc.setQueryData(['me'], me);
  qc.setQueryData(libraryKeys.quickReplies, []);
  qc.setQueryData(libraryKeys.labels, []);
  const ui = (id: string) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ChatPane conversationId={id} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(ui('1'));
  return { open: (id: string) => view.rerender(ui(id)) };
}

afterEach(cleanup);

describe('ChatPane when switching conversations', () => {
  it('keeps an unsent draft with its own conversation', () => {
    const { open } = setup();
    const box = () => screen.getByPlaceholderText(/Ketik pesan/) as HTMLTextAreaElement;
    fireEvent.change(box(), { target: { value: 'draf untuk Bu Sari' } });

    open('2');
    expect(box().value).toBe('');

    open('1');
    expect(box().value).toBe('draf untuk Bu Sari');
  });

  it('shows the display name of the open contact in the info panel', () => {
    const { open } = setup();
    fireEvent.click(screen.getByLabelText('Info kontak'));
    const input = () => screen.getByLabelText('Nama tampilan') as HTMLInputElement;
    expect(input().value).toBe('Bu Sari');

    open('2');
    expect(input().value).toBe('Pak Anwar');
  });
});
