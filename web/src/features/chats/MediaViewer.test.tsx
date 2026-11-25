import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import type { MessageDTO, MessagePage } from '@wa/shared';
import { MediaViewer } from './MediaViewer';
import { closeMediaViewer } from './mediaViewerStore';
import { MessageBubble } from './MessageBubble';
import { keys } from './queries';

const message = (id: string, over: Partial<MessageDTO> = {}): MessageDTO => ({
  id,
  conversationId: '1',
  wamid: `wamid.${id}`,
  direction: 'in',
  type: 'image',
  status: 'received',
  text: null,
  payload: null,
  media: { id: `m${id}`, mimeType: 'image/jpeg', fileName: null, fileSize: 1000, status: 'ready', url: `/api/media/m${id}` },
  replyTo: null,
  reactionEmoji: null,
  templateName: null,
  sentBy: null,
  clientRef: null,
  error: null,
  pricingCategory: null,
  timestamp: '2026-11-25T03:00:00.000Z',
  ...over,
});

const photo = message('10', { text: 'Foto KTP saya' });
const note = message('11', { type: 'text', text: 'Mohon dicek', media: null });
const clip = message('12', {
  type: 'video',
  direction: 'out',
  status: 'delivered',
  sentBy: { type: 'user', id: '7', name: 'Rina' },
  media: { id: 'm12', mimeType: 'video/mp4', fileName: null, fileSize: 5000, status: 'ready', url: '/api/media/m12' },
});
const pending = message('13', { media: { id: 'm13', mimeType: 'image/jpeg', fileName: null, fileSize: null, status: 'pending', url: '/api/media/m13' } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData<InfiniteData<MessagePage>>(keys.messages('1'), {
    pages: [{ messages: [photo, note, clip, pending], hasMore: false }],
    pageParams: [undefined],
  });
  return render(
    <QueryClientProvider client={qc}>
      <MessageBubble message={photo} />
      <MessageBubble message={clip} />
      <MediaViewer conversationId="1" contactName="Bu Sari" />
    </QueryClientProvider>,
  );
}

const viewer = () => screen.queryByRole('dialog');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  closeMediaViewer();
  cleanup();
  vi.unstubAllGlobals();
});

describe('chat media viewer', () => {
  it('opens a picture in a popup instead of a new tab', () => {
    const view = setup();
    expect(viewer()).toBeNull();
    // Gambar di gelembung bukan lagi tautan ke tab baru.
    expect(view.container.querySelector('a[target="_blank"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Buka gambar' }));
    const dialog = within(viewer()!);
    expect(dialog.getByRole('heading', { name: 'Bu Sari' })).toBeTruthy();
    expect(dialog.getByText(/1 dari 2/)).toBeTruthy();
    expect(dialog.getByText('Foto KTP saya')).toBeTruthy();
    const img = dialog.getByRole('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/media/m10');
    expect((dialog.getByRole('link', { name: 'Unduh' }) as HTMLAnchorElement).getAttribute('href')).toBe('/api/media/m10?download=1');
  });

  it('closes on the backdrop, the close button and Escape, but not when the picture itself is clicked', () => {
    setup();
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Buka gambar' }));

    open();
    // Klik pada gambar memperbesar, tidak menutup.
    fireEvent.click(within(viewer()!).getByRole('img'));
    expect(within(viewer()!).getByRole('button', { name: 'Perkecil' })).toBeTruthy();
    fireEvent.click(within(viewer()!).getByRole('img'));
    expect(within(viewer()!).getByRole('button', { name: 'Perbesar' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('media-viewer-stage'));
    expect(viewer()).toBeNull();

    open();
    fireEvent.click(within(viewer()!).getByRole('button', { name: 'Tutup' }));
    expect(viewer()).toBeNull();

    open();
    fireEvent.keyDown(viewer()!, { key: 'Escape' });
    expect(viewer()).toBeNull();
  });

  it('steps through the pictures and videos of the conversation, skipping other messages', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Buka gambar' }));
    expect((within(viewer()!).getByRole('button', { name: 'Media sebelumnya' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(viewer()!).getByRole('button', { name: 'Media berikutnya' }));
    const dialog = within(viewer()!);
    expect(dialog.getByRole('heading', { name: 'Rina' })).toBeTruthy();
    expect(dialog.getByText(/2 dari 2/)).toBeTruthy();
    const video = viewer()!.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/api/media/m12');
    expect(video.controls).toBe(true);
    // Media yang belum selesai diunduh tidak ikut; ini sudah yang terakhir.
    expect((dialog.getByRole('button', { name: 'Media berikutnya' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(viewer()!, { key: 'ArrowLeft' });
    expect(within(viewer()!).getByRole('heading', { name: 'Bu Sari' })).toBeTruthy();
  });

  it('plays a video from its thumbnail in the popup', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Putar video' }));
    expect(viewer()!.querySelector('video')!.getAttribute('src')).toBe('/api/media/m12');
    // Video tidak punya tombol perbesar.
    expect(within(viewer()!).queryByRole('button', { name: 'Perbesar' })).toBeNull();
  });
});
