import { eq } from 'drizzle-orm';
import { mediaKindFor } from '@wa/shared';
import { media } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { AppDeps } from '../../types';
import type { OutboundSpec } from './service';

export function textSpec(text: string): OutboundSpec {
  return {
    type: 'text',
    text,
    graph: { type: 'text', text: { body: text, preview_url: /https?:\/\//i.test(text) } },
    requiresWindow: true,
  };
}

/** Media keluar yang sudah diunggah lewat POST /api/media. */
export async function mediaSpec(deps: AppDeps, mediaId: number, caption?: string): Promise<OutboundSpec> {
  const [row] = await deps.database.db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!row || row.direction !== 'out' || row.status !== 'ready' || !row.waMediaId) {
    throw new AppError(400, 'media_invalid', 'Lampiran tidak ditemukan atau belum selesai diunggah.');
  }
  const kind = mediaKindFor(row.mimeType ?? 'application/octet-stream');
  const text = caption?.trim() || null;
  const content: Record<string, unknown> = { id: row.waMediaId };
  // WhatsApp tidak mendukung keterangan pada audio.
  if (text && kind !== 'audio') content.caption = text;
  if (kind === 'document' && row.fileName) content.filename = row.fileName;
  return {
    type: kind,
    text: kind === 'audio' ? null : text,
    mediaId: row.id,
    fileName: row.fileName,
    graph: { type: kind, [kind]: content },
    requiresWindow: true,
  };
}
