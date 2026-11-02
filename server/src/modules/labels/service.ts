import { asc, eq, inArray } from 'drizzle-orm';
import type { LabelDTO } from '@wa/shared';
import type { Db } from '../../db/client';
import { contactLabels, labels } from '../../db/schema';

export type LabelRow = typeof labels.$inferSelect;

export function labelDTO(l: LabelRow): LabelDTO {
  return { id: String(l.id), name: l.name, color: l.color };
}

/** Label setiap kontak (dimuat sekaligus), urut sesuai urutan label dibuat. */
export async function labelsByContact(db: Db, contactIds: number[]): Promise<Map<number, LabelDTO[]>> {
  const result = new Map<number, LabelDTO[]>();
  if (contactIds.length === 0) return result;
  const rows = await db
    .select({ contactId: contactLabels.contactId, label: labels })
    .from(contactLabels)
    .innerJoin(labels, eq(labels.id, contactLabels.labelId))
    .where(inArray(contactLabels.contactId, [...new Set(contactIds)]))
    .orderBy(asc(labels.id));
  for (const r of rows) {
    const list = result.get(r.contactId) ?? [];
    list.push(labelDTO(r.label));
    result.set(r.contactId, list);
  }
  return result;
}
