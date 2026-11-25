import type { AosMessageDTO, AosThreadDTO } from '@wa/shared';

/** Data tiruan untuk test AOS. */
export function aosMessage(patch: Partial<AosMessageDTO> & Pick<AosMessageDTO, 'id' | 'kind'>): AosMessageDTO {
  return {
    conversationId: '1',
    status: 'done',
    text: null,
    options: null,
    offerState: null,
    answer: null,
    steps: [],
    error: null,
    author: null,
    provider: null,
    model: null,
    durationMs: null,
    feedback: null,
    usedAt: null,
    savedDocumentId: null,
    createdAt: '2026-11-25T01:00:00.000Z',
    ...patch,
  };
}

export function aosThread(messages: AosMessageDTO[], patch: Partial<AosThreadDTO> = {}): AosThreadDTO {
  return { conversationId: messages[0]?.conversationId ?? '1', topicStartedAt: null, messages, openOfferId: null, ...patch };
}

export const offerMessage = (id: string, patch: Partial<AosMessageDTO> = {}): AosMessageDTO =>
  aosMessage({
    id,
    kind: 'offer',
    text: 'Bu Sari menanyakan cara mendapatkan kembali *EFIN yang lupa*. Mau saya bantu?',
    options: [
      { label: 'Buatkan rekomendasi jawaban', instruction: 'Buat draf balasan.', primary: true },
      { label: 'Syarat dan data yang perlu diminta ke WP', instruction: 'Sebutkan syaratnya.' },
    ],
    offerState: 'open',
    ...patch,
  });

export const DRAFT = 'Selamat pagi, Ibu. Untuk layanan *lupa EFIN*, mohon siapkan NPWP dan email aktif.';

export const draftAnswer = (id: string, patch: Partial<AosMessageDTO> = {}): AosMessageDTO =>
  aosMessage({
    id,
    kind: 'answer',
    text: `<draf>${DRAFT}</draf><catatan>- Verifikasi identitas dulu.</catatan><keyakinan>tinggi</keyakinan>`,
    answer: {
      draft: DRAFT,
      notes: '- Verifikasi identitas dulu.',
      confidence: 'tinggi',
      sources: [
        { type: 'library', title: 'Panduan Layanan EFIN.pdf', documentId: '7', page: 3 },
        { type: 'web', title: 'Lupa EFIN', url: 'https://www.pajak.go.id/id/lupa-efin' },
      ],
    },
    provider: 'subscription',
    model: 'claude-opus-5-5',
    durationMs: 14_200,
    ...patch,
  });
