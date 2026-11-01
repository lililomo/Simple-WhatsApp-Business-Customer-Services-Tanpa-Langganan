import { EventEmitter } from 'node:events';
import type { RealtimeEvent } from '@wa/shared';

/** Event internal satu proses: real-time ke browser (SSE) + sinyal untuk worker. */
export type BusEvent = RealtimeEvent | { type: 'webhook.stored' } | { type: 'delivery.created' };

const REALTIME_TYPES = new Set(['message.created', 'message.updated', 'conversation.updated', 'connection.updated', 'library.updated']);

/** Event yang boleh diteruskan ke browser (SSE); event internal tidak. */
export function isRealtimeEvent(event: BusEvent): event is RealtimeEvent {
  return REALTIME_TYPES.has(event.type);
}

export class EventBus {
  private readonly ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(0);
  }

  emit(event: BusEvent): void {
    this.ee.emit('event', event);
  }

  on(listener: (event: BusEvent) => void): () => void {
    this.ee.on('event', listener);
    return () => this.ee.off('event', listener);
  }
}
