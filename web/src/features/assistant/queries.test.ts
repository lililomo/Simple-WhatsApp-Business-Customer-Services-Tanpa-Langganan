import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { AosThreadDTO } from '@wa/shared';
import { applyAosMessage, aosKeys, upsertAosMessage } from './queries';
import { aosMessage, aosThread, offerMessage } from './test-fixtures';

const ids = (thread: AosThreadDTO) => thread.messages.map((m) => m.id);

describe('applyAosMessage', () => {
  it('appends a message it has not seen', () => {
    const thread = aosThread([aosMessage({ id: '1', kind: 'user', text: 'Halo' })]);
    const next = applyAosMessage(thread, aosMessage({ id: '2', kind: 'answer', status: 'pending' }));
    expect(ids(next)).toEqual(['1', '2']);
    expect(thread.messages).toHaveLength(1);
  });

  it('replaces a message with the same id in place', () => {
    const thread = aosThread([
      aosMessage({ id: '1', kind: 'user', text: 'Halo' }),
      aosMessage({ id: '2', kind: 'answer', status: 'running' }),
      aosMessage({ id: '3', kind: 'user', text: 'Lagi' }),
    ]);
    const next = applyAosMessage(thread, aosMessage({ id: '2', kind: 'answer', status: 'done', text: 'Selesai' }));
    expect(ids(next)).toEqual(['1', '2', '3']);
    expect(next.messages[1]).toMatchObject({ status: 'done', text: 'Selesai' });
  });

  it('keeps the order of creation when the POST answer and the SSE event arrive out of order', () => {
    // Event SSE untuk jawaban (id 11) tiba lebih dulu daripada jawaban POST yang memuat pertanyaannya (id 10).
    const thread = aosThread([aosMessage({ id: '9', kind: 'offer' }), aosMessage({ id: '11', kind: 'answer', status: 'pending' })]);
    const next = applyAosMessage(thread, aosMessage({ id: '10', kind: 'user', text: 'Buatkan jawaban' }));
    expect(ids(next)).toEqual(['9', '10', '11']);
  });

  it('remembers an open offer and forgets it once it is answered or dismissed', () => {
    const empty = aosThread([]);
    const offered = applyAosMessage(empty, offerMessage('5'));
    expect(offered.openOfferId).toBe('5');

    // Pesan lain tidak mengubah tawaran yang masih terbuka.
    const asked = applyAosMessage(offered, aosMessage({ id: '6', kind: 'user', text: 'Tanya lain' }));
    expect(asked.openOfferId).toBe('5');

    expect(applyAosMessage(asked, offerMessage('5', { offerState: 'answered' })).openOfferId).toBeNull();
    expect(applyAosMessage(asked, offerMessage('5', { offerState: 'dismissed' })).openOfferId).toBeNull();
  });

  it('moves to the newest open offer', () => {
    const thread = applyAosMessage(aosThread([offerMessage('5')], { openOfferId: '5' }), offerMessage('8'));
    expect(thread.openOfferId).toBe('8');
    // Tawaran lama ditutup server: yang baru tetap terbuka.
    expect(applyAosMessage(thread, offerMessage('5', { offerState: 'dismissed' })).openOfferId).toBe('8');
  });
});

describe('upsertAosMessage', () => {
  it('updates the cached thread of that conversation only', () => {
    const qc = new QueryClient();
    qc.setQueryData(aosKeys.thread('1'), aosThread([]));
    qc.setQueryData(aosKeys.thread('2'), aosThread([], { conversationId: '2' }));

    upsertAosMessage(qc, offerMessage('5'));

    expect(qc.getQueryData<AosThreadDTO>(aosKeys.thread('1'))).toMatchObject({ openOfferId: '5', messages: [{ id: '5' }] });
    expect(qc.getQueryData<AosThreadDTO>(aosKeys.thread('2'))?.messages).toEqual([]);
  });

  it('does not invent a thread that has not been loaded', () => {
    const qc = new QueryClient();
    upsertAosMessage(qc, offerMessage('5'));
    expect(qc.getQueryData(aosKeys.thread('1'))).toBeUndefined();
  });
});
