import { and, asc, desc, eq, gt, gte, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import type { KbSearchHit } from '@wa/shared';
import type { Db } from '../../db/client';
import { kbChunks, kbDocuments } from '../../db/schema';
import type { AppDeps } from '../../types';
import { localParts } from '../business-hours/schedule';
import { findHeadings, joinChunks } from './chunk';

/** InnoDB tidak mengindeks kata yang lebih pendek dari ini (innodb_ft_min_token_size). */
const FT_MIN_TOKEN = 3;
const MAX_QUERY = 200;
const MAX_TERMS = 8;
const SNIPPET_SIZE = 300;
/** Paling banyak sekian potongan per dokumen, supaya satu dokumen panjang tidak memenuhi seluruh hasil. */
const HITS_PER_DOCUMENT = 3;
/** Batas teks yang dikembalikan readKnowledge. */
const READ_LIMIT = 12_000;
const READ_BATCH = 40;
const TRUNCATED_MARK = '\n[… isi dipotong]';

/**
 * Syarat dokumen yang boleh dipakai AOS: siap, aktif, belum dihapus, dan belum lewat valid_until
 * (dibandingkan dengan tanggal hari ini di Asia/Jakarta; tanggal valid_until itu sendiri masih berlaku).
 */
export function usableDocuments(now = new Date()): SQL {
  return and(
    eq(kbDocuments.status, 'ready'),
    eq(kbDocuments.isActive, true),
    isNull(kbDocuments.deletedAt),
    or(isNull(kbDocuments.validUntil), gte(kbDocuments.validUntil, localParts(now).day)),
  )!;
}

export const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const cleanQuery = (query: string) => query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);

/** Kata-kata pencarian (huruf kecil, tanpa tanda baca). */
function termsOf(q: string): string[] {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

const fulltext = (q: string) => sql<number>`MATCH(${kbChunks.text}) AGAINST(${q} IN NATURAL LANGUAGE MODE)`;
const canFulltext = (terms: string[]) => terms.some((t) => t.length >= FT_MIN_TOKEN);
/** Pola LIKE cadangan: semua kata harus ada; kueri tanpa huruf/angka dicari apa adanya. */
const likeTerms = (q: string, terms: string[]) => (terms.length > 0 ? terms : [q]).map(likePattern);

interface Candidate {
  documentId: number;
  seq: number;
  page: number | null;
  heading: string | null;
  text: string;
  title: string;
  isOfficial: boolean;
  score: number;
}

const candidateColumns = {
  documentId: kbChunks.documentId,
  seq: kbChunks.seq,
  page: kbChunks.page,
  heading: kbChunks.heading,
  text: kbChunks.text,
  title: kbDocuments.title,
  isOfficial: kbDocuments.isOfficial,
};

const onDocument = eq(kbDocuments.id, kbChunks.documentId);

async function fulltextCandidates(db: Db, q: string, scope: SQL, limit: number): Promise<Candidate[]> {
  const relevance = fulltext(q);
  const rows = await db
    .select({ ...candidateColumns, score: relevance })
    .from(kbChunks)
    .innerJoin(kbDocuments, onDocument)
    .where(and(scope, relevance))
    .orderBy(desc(relevance))
    .limit(limit);
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

async function likeCandidates(db: Db, patterns: string[], scope: SQL, limit: number): Promise<Candidate[]> {
  const inText = await db
    .select(candidateColumns)
    .from(kbChunks)
    .innerJoin(kbDocuments, onDocument)
    .where(and(scope, ...patterns.map((p) => like(kbChunks.text, p))))
    .orderBy(desc(kbDocuments.isOfficial), desc(kbDocuments.id), asc(kbChunks.seq))
    .limit(limit);
  // Judul cocok tetapi isinya tidak: dokumen diwakili potongan pertamanya.
  const inTitle = await db
    .select(candidateColumns)
    .from(kbChunks)
    .innerJoin(kbDocuments, onDocument)
    .where(and(scope, eq(kbChunks.seq, 0), ...patterns.map((p) => like(kbDocuments.title, p))))
    .orderBy(desc(kbDocuments.isOfficial), desc(kbDocuments.id))
    .limit(limit);
  const seen = new Set(inText.map((r) => `${r.documentId}:${r.seq}`));
  return [
    ...inText.map((r) => ({ ...r, score: 1 })),
    ...inTitle.filter((r) => !seen.has(`${r.documentId}:${r.seq}`)).map((r) => ({ ...r, score: 0.5 })),
  ];
}

/** Urutkan kandidat: relevansi isi, ditambah bobot untuk judul yang cocok dan dokumen bertanda resmi. */
function rank(candidates: Candidate[], q: string, terms: string[]): Candidate[] {
  const top = Math.max(...candidates.map((c) => c.score), Number.MIN_VALUE);
  const phrase = q.toLowerCase();
  const scored = candidates.map((candidate) => {
    const title = candidate.title.toLowerCase();
    const matched = terms.filter((t) => title.includes(t)).length;
    const titleBoost = title.includes(phrase) ? 0.5 : terms.length > 0 ? (0.3 * matched) / terms.length : 0;
    return { candidate, score: candidate.score / top + titleBoost + (candidate.isOfficial ? 0.25 : 0) };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score || b.candidate.documentId - a.candidate.documentId || a.candidate.seq - b.candidate.seq,
  );
  const perDocument = new Map<number, number>();
  return scored
    .map((s) => s.candidate)
    .filter((c) => {
      const count = (perDocument.get(c.documentId) ?? 0) + 1;
      perDocument.set(c.documentId, count);
      return count <= HITS_PER_DOCUMENT;
    });
}

/** Posisi kata yang cocok di dalam teks (frasa utuh lebih dulu, lalu kata terpanjang); -1 bila hanya judulnya yang cocok. */
function matchIndex(lower: string, q: string, terms: string[]): number {
  let at = lower.indexOf(q.toLowerCase());
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    if (at >= 0) break;
    at = lower.indexOf(term);
  }
  return at;
}

/**
 * Judul bagian tempat kata yang cocok berada. Judul potongan (kb_chunks.heading) berlaku untuk awal potongan;
 * bila potongan itu memuat judul bagian baru sebelum kata yang cocok, judul baru itulah yang benar.
 */
function headingAtMatch(candidate: Candidate, q: string, terms: string[]): string | null {
  const at = matchIndex(candidate.text.toLowerCase(), q, terms);
  if (at < 0) return candidate.heading;
  const inner = findHeadings(candidate.text).findLast((h) => h.at <= at);
  return inner ? inner.text.replace(/\s+/g, ' ').trim().slice(0, 255) : candidate.heading;
}

/** Cuplikan ±SNIPPET_SIZE karakter di sekitar kata yang cocok (atau awal teks bila yang cocok hanya judulnya). */
export function snippetAround(text: string, q: string, terms: string[], size = SNIPPET_SIZE): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= size) return flat;
  const at = Math.max(matchIndex(flat.toLowerCase(), q, terms), 0);
  let end = Math.min(flat.length, Math.max(0, at - Math.floor(size / 3)) + size);
  let start = Math.max(0, end - size);
  // Rapikan ke batas kata bila tidak memotong bagian yang cocok.
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > at + Math.floor(size / 3)) end = space;
  }
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/**
 * Cari potongan Pustaka yang relevan untuk AOS. FULLTEXT lebih dulu; bila tidak ada hasil (atau kuerinya
 * terlalu pendek untuk diindeks) dicari dengan LIKE pada isi dan judul.
 * Hanya dokumen yang siap, aktif, belum dihapus, dan belum lewat valid_until.
 */
export async function searchKnowledge(deps: AppDeps, query: string, limit = 8): Promise<KbSearchHit[]> {
  const q = cleanQuery(query);
  if (!q) return [];
  const max = Math.min(Math.max(Math.trunc(limit) || 1, 1), 50);
  const { db } = deps.database;
  const scope = usableDocuments();
  const terms = termsOf(q);
  const pool = Math.max(max * 4, 24);

  let candidates = canFulltext(terms) ? await fulltextCandidates(db, q, scope, pool) : [];
  if (candidates.length === 0) candidates = await likeCandidates(db, likeTerms(q, terms), scope, pool);

  return rank(candidates, q, terms)
    .slice(0, max)
    .map((c) => ({
      documentId: String(c.documentId),
      title: c.title,
      page: c.page,
      heading: headingAtMatch(c, q, terms),
      snippet: snippetAround(c.text, q, terms),
      isOfficial: c.isOfficial,
    }));
}

/** ID dokumen dalam `scope` yang isinya cocok dengan kueri; dipakai saringan `q` di halaman Pustaka. */
export async function documentIdsMatchingContent(db: Db, query: string, scope: SQL, limit = 500): Promise<number[]> {
  const q = cleanQuery(query);
  if (!q) return [];
  const terms = termsOf(q);
  const matching = (condition: SQL | undefined) =>
    db
      .selectDistinct({ id: kbChunks.documentId })
      .from(kbChunks)
      .innerJoin(kbDocuments, onDocument)
      .where(and(scope, condition))
      .limit(limit);
  let rows = canFulltext(terms) ? await matching(fulltext(q)) : [];
  if (rows.length === 0) rows = await matching(and(...likeTerms(q, terms).map((p) => like(kbChunks.text, p))));
  return rows.map((r) => r.id);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return `${text.slice(0, end).trimEnd()}${TRUNCATED_MARK}`;
}

/**
 * Baca isi dokumen untuk AOS. Dengan `page` (dokumen berhalaman): teks halaman itu. Tanpa `page`: seluruh
 * isi, dipotong ±12.000 karakter; pada dokumen berhalaman tiap halaman diawali penanda "[Halaman n]".
 * Null bila dokumen tidak ada atau tidak boleh dipakai AOS (lihat usableDocuments).
 */
export async function readKnowledge(
  deps: AppDeps,
  documentId: number,
  page?: number | null,
): Promise<{ title: string; page: number | null; pageCount: number | null; text: string } | null> {
  const { db } = deps.database;
  if (!Number.isSafeInteger(documentId) || documentId <= 0) return null;
  const [doc] = await db
    .select({ id: kbDocuments.id, title: kbDocuments.title, pageCount: kbDocuments.pageCount })
    .from(kbDocuments)
    .where(and(eq(kbDocuments.id, documentId), usableDocuments()))
    .limit(1);
  if (!doc) return null;
  // Dokumen tanpa halaman (DOCX, teks, catatan, gambar) selalu dibaca utuh.
  const wanted = doc.pageCount !== null && typeof page === 'number' && Number.isInteger(page) && page >= 1 ? page : null;

  // Ambil potongan secukupnya saja; dokumen besar tidak perlu dimuat seluruhnya untuk ±12.000 karakter.
  const rows: { seq: number; page: number | null; text: string }[] = [];
  let size = 0;
  let after = -1;
  while (size < READ_LIMIT * 1.5) {
    const batch = await db
      .select({ seq: kbChunks.seq, page: kbChunks.page, text: kbChunks.text })
      .from(kbChunks)
      .where(
        and(
          eq(kbChunks.documentId, doc.id),
          gt(kbChunks.seq, after),
          wanted === null ? undefined : eq(kbChunks.page, wanted),
        ),
      )
      .orderBy(asc(kbChunks.seq))
      .limit(READ_BATCH);
    for (const row of batch) {
      rows.push(row);
      size += row.text.length;
    }
    if (batch.length < READ_BATCH) break;
    after = batch.at(-1)!.seq;
  }

  // Potongan dari halaman yang sama digabung tanpa mengulang bagian tumpang-tindihnya.
  const groups: { page: number | null; parts: string[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.page === row.page) last.parts.push(row.text);
    else groups.push({ page: row.page, parts: [row.text] });
  }
  const text = groups
    .map((g) => `${wanted === null && g.page !== null ? `[Halaman ${g.page}]\n` : ''}${joinChunks(g.parts)}`)
    .join('\n\n');
  return { title: doc.title, page: wanted, pageCount: doc.pageCount, text: truncate(text, READ_LIMIT) };
}

/** Daftar dokumen yang boleh dipakai AOS (sumber resmi lebih dulu, lalu yang terbaru), untuk konteks awal AOS. */
export async function knowledgeCatalog(
  deps: AppDeps,
  maxDocs = 50,
): Promise<{ id: string; title: string; summary: string | null; isOfficial: boolean; pageCount: number | null }[]> {
  const rows = await deps.database.db
    .select({
      id: kbDocuments.id,
      title: kbDocuments.title,
      summary: kbDocuments.summary,
      isOfficial: kbDocuments.isOfficial,
      pageCount: kbDocuments.pageCount,
    })
    .from(kbDocuments)
    .where(usableDocuments())
    .orderBy(desc(kbDocuments.isOfficial), desc(kbDocuments.createdAt), desc(kbDocuments.id))
    .limit(Math.min(Math.max(Math.trunc(maxDocs) || 1, 1), 500));
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}
