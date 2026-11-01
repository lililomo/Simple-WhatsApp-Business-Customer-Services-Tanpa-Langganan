import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import {
  renderTemplateText,
  templateVariables,
  type TemplateComponent,
  type TemplateDTO,
  type TemplateParams,
} from '@wa/shared';
import { media, templates } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import type { AppDeps } from '../../types';
import { accountGraph, metaToAppError, noteTokenError, type WaAccount } from '../connection/service';
import type { OutboundSpec } from '../messages/service';

type TemplateRow = typeof templates.$inferSelect;

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: TemplateComponent[];
  quality_score?: { score?: string };
  rejected_reason?: string;
  parameter_format?: string;
}

export function toTemplateDTO(t: TemplateRow): TemplateDTO {
  return {
    id: String(t.id),
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    qualityScore: t.qualityScore,
    rejectedReason: t.rejectedReason,
    components: t.components as TemplateComponent[],
    variables: templateVariables(t.components as TemplateComponent[]),
    syncedAt: t.syncedAt.toISOString(),
  };
}

/** Ambil semua template dari Meta (dengan paging), upsert, dan tandai yang sudah dihapus di Meta. */
export async function syncTemplates(deps: AppDeps, account: WaAccount): Promise<{ synced: number; deleted: number }> {
  const { db } = deps.database;
  const graph = accountGraph(deps, account);
  const all: MetaTemplate[] = [];
  let after: string | undefined;
  try {
    do {
      const page = await graph.get<{ data: MetaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>(
        `${account.wabaId}/message_templates`,
        {
          fields: 'id,name,language,status,category,components,quality_score,rejected_reason,parameter_format',
          limit: 100,
          after,
        },
      );
      all.push(...page.data);
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
    } while (after);
  } catch (err) {
    await noteTokenError(deps, account, err);
    throw metaToAppError(err);
  }

  const now = new Date();
  for (const t of all) {
    const values = {
      metaTemplateId: t.id,
      category: t.category,
      status: t.status,
      components: t.components ?? [],
      qualityScore: t.quality_score?.score ?? null,
      rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
      syncedAt: now,
    };
    await db
      .insert(templates)
      .values({ waAccountId: account.id, name: t.name, language: t.language, ...values })
      .onDuplicateKeyUpdate({ set: values });
  }
  const seen = all.map((t) => t.id);
  const gone = await db
    .update(templates)
    .set({ status: 'DELETED', syncedAt: now })
    .where(
      and(
        eq(templates.waAccountId, account.id),
        sql`${templates.status} <> 'DELETED'`,
        ...(seen.length ? [notInArray(templates.metaTemplateId, seen)] : []),
      ),
    );
  return { synced: all.length, deleted: gone[0].affectedRows };
}

export async function listTemplates(deps: AppDeps, status?: string): Promise<TemplateDTO[]> {
  const rows = await deps.database.db
    .select()
    .from(templates)
    .where(status ? eq(templates.status, status) : sql`${templates.status} <> 'DELETED'`)
    .orderBy(asc(templates.name), asc(templates.language));
  return rows.map(toTemplateDTO);
}

export async function getTemplate(deps: AppDeps, id: number): Promise<TemplateRow> {
  const [row] = await deps.database.db.select().from(templates).where(eq(templates.id, id)).limit(1);
  if (!row) throw notFound('Template');
  return row;
}

function textParams(keys: string[], values: Record<string, string> | undefined, named: boolean, where: string) {
  const missing = keys.filter((k) => !values?.[k]);
  if (missing.length) {
    throw new AppError(400, 'template_params', `Variabel ${where} belum diisi: ${missing.map((k) => `{{${k}}}`).join(', ')}.`, { missing });
  }
  return keys.map((k) => ({ type: 'text', text: values![k]!, ...(named ? { parameter_name: k } : {}) }));
}

/** Bentuk pesan template: komponen parameter untuk Graph + teks hasil isian untuk ditampilkan. */
export async function templateSpec(deps: AppDeps, row: TemplateRow, params: TemplateParams): Promise<OutboundSpec> {
  if (row.status !== 'APPROVED') {
    throw new AppError(400, 'template_not_approved', `Template "${row.name}" berstatus ${row.status}, belum bisa dikirim.`);
  }
  const components = row.components as TemplateComponent[];
  const vars = templateVariables(components);
  const graphComponents: Record<string, unknown>[] = [];

  if (vars.header) {
    const format = vars.header.format.toUpperCase();
    if (format === 'TEXT' && vars.header.keys.length) {
      graphComponents.push({ type: 'header', parameters: textParams(vars.header.keys, params.header, vars.named, 'header') });
    } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
      if (!params.headerMediaId) throw new AppError(400, 'template_params', 'Template ini butuh lampiran di header. Unggah file terlebih dahulu.');
      const [m] = await deps.database.db.select().from(media).where(eq(media.id, Number(params.headerMediaId))).limit(1);
      if (!m?.waMediaId || m.direction !== 'out') throw new AppError(400, 'media_invalid', 'Lampiran header tidak valid.');
      const kind = format.toLowerCase();
      graphComponents.push({
        type: 'header',
        parameters: [{ type: kind, [kind]: { id: m.waMediaId, ...(kind === 'document' && m.fileName ? { filename: m.fileName } : {}) } }],
      });
    }
  }
  if (vars.body.length) {
    graphComponents.push({ type: 'body', parameters: textParams(vars.body, params.body, vars.named, 'isi') });
  }
  // Tiap tombol URL dinamis punya tepat satu variabel; nilainya dikunci dengan indeks tombol ("0", "1"),
  // karena dua tombol sama-sama memakai {{1}}.
  for (const b of vars.buttons) {
    const key = String(b.index);
    if (!params.buttons?.[key]) {
      throw new AppError(400, 'template_params', `Variabel tombol "${b.text}" belum diisi.`, { missing: [`buttons.${key}`] });
    }
    graphComponents.push({
      type: 'button',
      sub_type: 'url',
      index: key,
      parameters: [{ type: 'text', text: params.buttons[key] }],
    });
  }

  return {
    type: 'template',
    text: renderTemplateText(components, params),
    mediaId: params.headerMediaId ? Number(params.headerMediaId) : null,
    templateName: row.name,
    templateLanguage: row.language,
    graph: {
      type: 'template',
      template: { name: row.name, language: { code: row.language }, ...(graphComponents.length ? { components: graphComponents } : {}) },
    },
    requiresWindow: false,
  };
}
