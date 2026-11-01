import { EventEmitter } from 'node:events';
import type { RealtimeEvent } from '@wa/shared';

/** Event internal satu proses: real-time ke browser (SSE) + sinyal untuk worker. */
export type BusEvent = RealtimeEvent | { type: 'webhook.stored' };

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
