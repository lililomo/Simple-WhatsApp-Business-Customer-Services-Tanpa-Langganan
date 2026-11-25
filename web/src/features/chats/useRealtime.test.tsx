import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { RECONNECT_DELAYS_MS, useRealtime } from './useRealtime';

/** EventSource tiruan: jsdom tidak punya, dan tes perlu mengatur sendiri kapan sambungan putus. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.OPEN;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, EventListener[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data: '{}' }));
  }
  /** Browser menyerah (server menjawab selain 200) atau masih mencoba sendiri (jaringan putus). */
  fail(state: number) {
    this.readyState = state;
    this.onerror?.();
  }
}

function Probe() {
  useRealtime();
  return null;
}

const [first, second, third] = RECONNECT_DELAYS_MS as [number, number, number];
const sources = () => FakeEventSource.instances;
let qc: QueryClient;
let fetchMock: ReturnType<typeof vi.fn<() => Promise<Response>>>;

const answer = (status: number) => () =>
  Promise.resolve(
    new Response(
      JSON.stringify(status === 200 ? { user: { id: '1' } } : { error: { code: 'x', message: 'x' } }),
      { status },
    ),
  );

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  fetchMock = vi.fn(answer(200));
  vi.stubGlobal('fetch', fetchMock);
  qc = new QueryClient();
  qc.setQueryData(['me'], { id: '1' });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useRealtime reconnect', () => {
  it('opens a new connection after the browser gives up, then refetches what it missed', async () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    sources()[0]!.fail(FakeEventSource.CLOSED);
    await vi.advanceTimersByTimeAsync(first);

    expect(sources()).toHaveLength(2);
    sources()[1]!.emit('hello');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversations'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['assistant-thread'] });
  });

  it('keeps trying, with growing delays, while the server is unavailable', async () => {
    fetchMock.mockImplementation(answer(503));
    sources()[0]!.fail(FakeEventSource.CLOSED);
    await vi.advanceTimersByTimeAsync(first);
    await vi.advanceTimersByTimeAsync(second);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sources()).toHaveLength(1);

    fetchMock.mockImplementation(answer(200));
    await vi.advanceTimersByTimeAsync(third);
    expect(sources()).toHaveLength(2);
  });

  it('sends the user to the login page when the session has ended', async () => {
    fetchMock.mockImplementation(answer(401));
    sources()[0]!.fail(FakeEventSource.CLOSED);
    await vi.advanceTimersByTimeAsync(first);
    expect(qc.getQueryData(['me'])).toBeNull();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sources()).toHaveLength(1);
  });

  it('leaves the connection alone while the browser is still retrying by itself', async () => {
    sources()[0]!.fail(FakeEventSource.CONNECTING);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sources()).toHaveLength(1);
  });

  it('reconnects at once when the tab becomes visible again', async () => {
    fetchMock.mockImplementation(answer(503));
    sources()[0]!.fail(FakeEventSource.CLOSED);
    await vi.advanceTimersByTimeAsync(first);
    expect(sources()).toHaveLength(1);

    fetchMock.mockImplementation(answer(200));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sources()).toHaveLength(2);
  });
});
