import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { AosThreadDTO, RealtimeEvent } from '@wa/shared';
import { useRealtime } from '@/features/chats/useRealtime';
import { useAosLive } from './live';
import { aosKeys } from './queries';
import { aosMessage, aosThread, offerMessage } from './test-fixtures';

/** EventSource tiruan yang bisa disuruh mengirim event server. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static last: FakeEventSource;
  readyState = FakeEventSource.OPEN;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, EventListener[]>();

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  send(event: RealtimeEvent) {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(new MessageEvent(event.type, { data: JSON.stringify(event) }));
    }
  }
}

function Probe({ watch }: { watch: string }) {
  useRealtime();
  const live = useAosLive(watch);
  return <output data-testid="live">{live ? `${live.steps.at(-1) ?? ''}|${live.text}` : ''}</output>;
}

let qc: QueryClient;
const send = (event: RealtimeEvent) => act(() => FakeEventSource.last.send(event));
const thread = (id = '1') => qc.getQueryData<AosThreadDTO>(aosKeys.thread(id));

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Probe watch="21" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useRealtime with AOS events', () => {
  it('appends a new message from assistant.updated and replaces one it already has', () => {
    qc.setQueryData(aosKeys.thread('1'), aosThread([aosMessage({ id: '20', kind: 'user', text: 'Buatkan jawaban' })]));

    send({ type: 'assistant.updated', conversationId: '1', message: aosMessage({ id: '21', kind: 'answer', status: 'running' }) });
    expect(thread()?.messages.map((m) => [m.id, m.status])).toEqual([
      ['20', 'done'],
      ['21', 'running'],
    ]);

    send({ type: 'assistant.updated', conversationId: '1', message: aosMessage({ id: '21', kind: 'answer', status: 'done', text: 'Selesai' }) });
    expect(thread()?.messages.map((m) => [m.id, m.status])).toEqual([
      ['20', 'done'],
      ['21', 'done'],
    ]);
  });

  it('sets openOfferId when an open offer arrives and clears it when that offer closes', () => {
    qc.setQueryData(aosKeys.thread('1'), aosThread([]));

    send({ type: 'assistant.updated', conversationId: '1', message: offerMessage('30') });
    expect(thread()?.openOfferId).toBe('30');

    send({ type: 'assistant.updated', conversationId: '1', message: offerMessage('30', { offerState: 'answered' }) });
    expect(thread()?.openOfferId).toBeNull();
    expect(thread()?.messages).toHaveLength(1);
  });

  it('leaves conversations whose thread is not loaded alone', () => {
    send({ type: 'assistant.updated', conversationId: '9', message: offerMessage('31', { conversationId: '9' }) });
    expect(thread('9')).toBeUndefined();
  });

  it('keeps streaming text out of the query cache and drops it when the answer finishes', () => {
    const running = aosMessage({ id: '21', kind: 'answer', status: 'running' });
    qc.setQueryData(aosKeys.thread('1'), aosThread([running]));

    send({ type: 'assistant.delta', conversationId: '1', messageId: '21', text: '<draf>Selamat pagi', steps: ['Mencari di Pustaka…'] });
    expect(screen.getByTestId('live').textContent).toBe('Mencari di Pustaka…|<draf>Selamat pagi');
    expect(thread()?.messages[0]).toBe(running);

    send({ type: 'assistant.updated', conversationId: '1', message: { ...running, status: 'done', text: '<draf>Selamat pagi, Ibu.</draf>' } });
    expect(screen.getByTestId('live').textContent).toBe('');
  });

  it('reloads the thread on assistant.thread', () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    send({ type: 'assistant.thread', conversationId: '1' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['assistant-thread', '1'] });
  });
});
