import { strFromU8, unzipSync } from 'fflate';
import { normalizeText, type Segment } from './chunk';
import type { KnowledgeAi } from './service';

/** Kegagalan ekstraksi yang pesannya (bahasa Indonesia) aman ditampilkan ke petugas. */
export class ExtractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExtractError';
  }
}

export interface Extracted {
  /** Teks per halaman/slide (page terisi) atau satu bagian tanpa halaman; hanya bagian yang berisi teks. */
  segments: Segment[];
  /** Jumlah halaman/slide berkas aslinya; null untuk berkas tanpa halaman. */
  pageCount: number | null;
}

const MIB = 1024 * 1024;
/** Batas isi XML (setelah dibuka dari ZIP) yang mau dibaca, untuk menolak berkas Office yang tidak wajar. */
const MAX_UNZIPPED_BYTES = 200 * MIB;
/** Panggilan AI yang menggantung tidak boleh menghentikan antrean pemrosesan. */
export const AI_TIMEOUT_MS = 120_000;

const NO_TEXT = 'Berkas ini tidak berisi teks yang bisa dibaca.';
const SCANNED_PDF =
  'PDF ini tidak berisi teks (kemungkinan hasil pindai), dan PDF pindaian belum didukung. ' +
  'Unggah PDF berteks, atau unggah gambar tiap halamannya (JPG/PNG).';

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Baca isi berkas Pustaka menjadi teks per halaman. `ext` = ekstensi tanpa titik, huruf kecil (KB_EXTENSIONS).
 * Melempar ExtractError bila berkasnya tidak bisa dibaca atau tidak berisi teks.
 */
export async function extractDocument(data: Buffer, ext: string, ai: KnowledgeAi | null): Promise<Extracted> {
  const raw = await extractRaw(data, ext, ai);
  const segments = raw.segments
    .map((s) => ({ ...s, text: normalizeText(s.text) }))
    .filter((s) => s.text !== '');
  if (segments.length === 0) throw new ExtractError(ext === 'pdf' ? SCANNED_PDF : NO_TEXT);
  return { segments, pageCount: raw.pageCount };
}

function extractRaw(data: Buffer, ext: string, ai: KnowledgeAi | null): Extracted | Promise<Extracted> {
  switch (ext) {
    case 'pdf':
      return extractPdf(data);
    case 'docx':
      return extractDocx(data);
    case 'pptx':
      return extractPptx(data);
    case 'txt':
    case 'md':
    case 'csv':
      return { segments: [{ page: null, text: decodeText(data) }], pageCount: null };
    case 'jpg':
    case 'jpeg':
    case 'png':
      return extractImage(data, ai);
    default:
      throw new ExtractError('Jenis berkas ini belum bisa dibaca.');
  }
}

// ---------- Teks polos ----------

/** UTF-8 (dengan atau tanpa BOM) atau UTF-16 ber-BOM; berkas lama yang bukan UTF-8 dibaca sebagai Windows-1252. */
export function decodeText(data: Buffer): string {
  let text: string;
  if (data[0] === 0xff && data[1] === 0xfe) text = new TextDecoder('utf-16le').decode(data);
  else if (data[0] === 0xfe && data[1] === 0xff) text = new TextDecoder('utf-16be').decode(data);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      text = new TextDecoder('windows-1252').decode(data);
    }
  }
  if (text.slice(0, 8192).includes('\u0000')) throw new ExtractError('Berkas ini tampaknya bukan berkas teks.');
  return text;
}

// ---------- PDF ----------

const PDF_UNREADABLE = new Set(['InvalidPDFException', 'FormatError', 'XRefParseException', 'MissingPDFException']);

async function extractPdf(data: Buffer): Promise<Extracted> {
  if (!data.subarray(0, 1024).includes('%PDF-')) throw new ExtractError('Berkas ini bukan PDF yang valid.');
  const { extractText, getDocumentProxy } = await import('unpdf');
  // Salinan: PDF.js mengambil alih buffer yang diberikan kepadanya.
  const pdf = await getDocumentProxy(new Uint8Array(data), { verbosity: 0 }).catch((err: unknown) => {
    const name = err instanceof Error ? err.name : '';
    if (name === 'PasswordException') {
      throw new ExtractError('PDF ini dikunci kata sandi. Unggah versi yang tidak dikunci.', { cause: err });
    }
    if (PDF_UNREADABLE.has(name)) throw new ExtractError('PDF ini rusak atau tidak bisa dibuka.', { cause: err });
    throw err;
  });
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return { segments: text.map((page, i) => ({ page: i + 1, text: page })), pageCount: totalPages };
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

// ---------- DOCX / PPTX (ZIP berisi XML) ----------

/** Daftar isi ZIP tanpa membuka isinya. */
function zipEntries(data: Buffer, label: string): Map<string, number> {
  const entries = new Map<string, number>();
  try {
    unzipSync(data, {
      filter: (file) => {
        entries.set(file.name, file.originalSize);
        return false;
      },
    });
  } catch (err) {
    throw new ExtractError(`Berkas ini rusak, dikunci kata sandi, atau bukan ${label} yang valid.`, { cause: err });
  }
  return entries;
}

function assertReadableSize(bytes: number, label: string): void {
  if (bytes > MAX_UNZIPPED_BYTES) throw new ExtractError(`Isi berkas ${label} ini terlalu besar untuk dibaca.`);
}

async function extractDocx(data: Buffer): Promise<Extracted> {
  const entries = zipEntries(data, 'DOCX');
  const size = entries.get('word/document.xml');
  if (size === undefined) throw new ExtractError('Berkas ini bukan DOCX yang valid.');
  assertReadableSize(size, 'DOCX');
  const { default: mammoth } = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: data }).catch((err: unknown) => {
    throw new ExtractError('Berkas DOCX ini rusak atau tidak bisa dibaca.', { cause: err });
  });
  return { segments: [{ page: null, text: result.value }], pageCount: null };
}

const SLIDE_FILE = /^ppt\/slides\/slide(\d+)\.xml$/;
const PRESENTATION = 'ppt/presentation.xml';
const PRESENTATION_RELS = 'ppt/_rels/presentation.xml.rels';

function extractPptx(data: Buffer): Extracted {
  const entries = zipEntries(data, 'PPTX');
  const wanted = [...entries.keys()].filter((n) => SLIDE_FILE.test(n) || n === PRESENTATION || n === PRESENTATION_RELS);
  assertReadableSize(
    wanted.reduce((sum, name) => sum + entries.get(name)!, 0),
    'PPTX',
  );
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (file) => wanted.includes(file.name) });
  } catch (err) {
    throw new ExtractError('Berkas PPTX ini rusak atau tidak bisa dibaca.', { cause: err });
  }
  const slides = slideOrder(files);
  if (slides.length === 0) throw new ExtractError('Berkas ini bukan PPTX yang valid atau tidak berisi slide.');
  return {
    segments: slides.map((name, i) => ({ page: i + 1, ...slideText(strFromU8(files[name]!)) })),
    pageCount: slides.length,
  };
}

const xmlAttr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/**
 * Nama berkas slide sesuai urutan presentasi (ppt/presentation.xml). Nomor pada nama berkas tidak selalu sama
 * dengan urutan tampilnya; bila daftar urutannya tidak terbaca, pakai urutan nomor berkas.
 */
function slideOrder(files: Record<string, Uint8Array>): string[] {
  const slideNo = (name: string) => Number(SLIDE_FILE.exec(name)![1]);
  const byNumber = Object.keys(files)
    .filter((name) => SLIDE_FILE.test(name))
    .sort((a, b) => slideNo(a) - slideNo(b));
  const presentation = files[PRESENTATION];
  const rels = files[PRESENTATION_RELS];
  if (!presentation || !rels) return byNumber;

  const targets = new Map<string, string>();
  for (const [tag] of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = xmlAttr(tag, 'Id');
    const target = xmlAttr(tag, 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `ppt/${target}`);
  }
  const ordered: string[] = [];
  for (const [tag] of strFromU8(presentation).matchAll(/<p:sldId\b[^>]*>/g)) {
    const name = targets.get(xmlAttr(tag, 'r:id') ?? '');
    if (name && files[name] && SLIDE_FILE.test(name) && !ordered.includes(name)) ordered.push(name);
  }
  return ordered.length > 0 ? ordered : byNumber;
}

/** Teks satu slide (satu baris per paragraf) dan judulnya bila slide punya kotak judul. */
function slideText(xml: string): { text: string; heading: string | null } {
  let heading: string | null = null;
  for (const [shape] of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    if (/<p:ph\b[^>]*\stype="(?:title|ctrTitle)"/.test(shape)) {
      heading = xmlParagraphs(shape).join(' ') || null;
      break;
    }
  }
  return { text: xmlParagraphs(xml).join('\n'), heading };
}

function xmlParagraphs(xml: string): string[] {
  const out: string[] = [];
  for (const paragraph of xml.matchAll(/<a:p(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/a:p>)/g)) {
    let line = '';
    for (const run of (paragraph[1] ?? '').matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*>/g)) {
      line += run[1] === undefined ? '\n' : decodeXml(run[1]);
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    if (!entity.startsWith('#')) return XML_ENTITIES[entity.toLowerCase()] ?? whole;
    const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

// ---------- Gambar ----------

function imageMime(data: Buffer): string | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

/** Gambar dibaca lewat koneksi AI (KnowledgeAi.readImage) karena server tidak punya OCR sendiri. */
async function extractImage(data: Buffer, ai: KnowledgeAi | null): Promise<Extracted> {
  const mime = imageMime(data);
  if (!mime) throw new ExtractError('Berkas ini bukan gambar JPG/PNG yang valid.');
  if (!ai?.readImage) {
    throw new ExtractError(
      'Membaca gambar membutuhkan koneksi AI. Hubungkan Asisten AI di Pengaturan, lalu proses ulang berkas ini.',
    );
  }
  const readImage = ai.readImage.bind(ai);
  const reading = Promise.resolve().then(() => readImage(data, mime));
  const text = await withTimeout(reading, AI_TIMEOUT_MS).catch((err: unknown) => {
    throw new ExtractError('Gambar gagal dibaca lewat koneksi AI. Coba proses ulang beberapa saat lagi.', {
      cause: err,
    });
  });
  if (!text?.trim()) throw new ExtractError('Tidak ada teks yang terbaca dari gambar ini.');
  return { segments: [{ page: null, text }], pageCount: null };
}
