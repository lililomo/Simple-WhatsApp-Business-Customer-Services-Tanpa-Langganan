/** Pemotongan teks dokumen Pustaka menjadi kb_chunks. Hanya fungsi teks, tanpa I/O. */

/** Satu bagian hasil ekstraksi: satu halaman/slide, atau seluruh isi (page null) untuk berkas tanpa halaman. */
export interface Segment {
  page: number | null;
  text: string;
  /** Judul yang sudah diketahui dari berkasnya (mis. judul slide); bila kosong, dicari dari teksnya. */
  heading?: string | null;
}

export interface Chunk {
  page: number | null;
  heading: string | null;
  text: string;
}

/** Ukuran sasaran satu potongan dan tumpang-tindih antarpotongan, dalam karakter. */
export const CHUNK_SIZE = 1500;
export const CHUNK_OVERLAP = 150;
/** Tumpang-tindih lebih pendek dari ini dibuang, supaya joinChunks tidak salah mengenali kebetulan. */
const MIN_OVERLAP = 20;
const HEADING_MAX = 255;

/** Rapikan teks hasil ekstraksi: akhir baris seragam, tanpa karakter kontrol, spasi dan baris kosong dirapatkan. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\f\v]/g, '\n\n')
    // Tanda hubung lunak, spasi tanpa lebar, dan BOM: tidak terlihat tetapi mengganggu pencarian.
    .replace(/[\u00AD\u200B\uFEFF]/g, '')
    .replace(/(?![\n\t])\p{Cc}/gu, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cuplikan awal teks (satu baris), dipotong di batas kata. */
export function excerpt(text: string, max = 300): string {
  const flat = text
    .slice(0, max * 4)
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.lastIndexOf(' ', max);
  return `${flat.slice(0, cut > max * 0.6 ? cut : max).trimEnd()}…`;
}

/**
 * Tempat memotong di antara min..max. Urutan pilihan: batas paragraf, baris, kalimat, kata; terakhir potong
 * paksa. Hasilnya selalu tepat setelah karakter bukan spasi, sehingga potongan tidak berakhir dengan spasi.
 */
function breakAt(text: string, min: number, max: number): number {
  const window = text.slice(min, max);
  let end = max;
  const paragraph = window.lastIndexOf('\n\n');
  const line = window.lastIndexOf('\n');
  const sentence = [...window.matchAll(/[.!?;:]["')\]]?(?=\s)/g)].at(-1);
  const space = window.lastIndexOf(' ');
  if (paragraph >= 0) end = min + paragraph;
  else if (line >= 0) end = min + line;
  else if (sentence) end = min + sentence.index + sentence[0].length;
  else if (space >= 0) end = min + space;
  // Jangan memotong di tengah pasangan surrogate (emoji).
  else if (isHighSurrogate(text.charCodeAt(max - 1))) end = max - 1;
  while (end > 0 && /\s/.test(text[end - 1]!)) end--;
  return end;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/**
 * Awal bagian tumpang-tindih untuk teks yang berakhir di `end`: mundur CHUNK_OVERLAP karakter, lalu maju ke
 * awal kata berikutnya. Hasilnya hanya bergantung pada CHUNK_OVERLAP karakter terakhir, jadi joinChunks
 * bisa menghitung ulang panjang tumpang-tindih dari potongan sebelumnya saja. Mengembalikan `end` bila
 * tidak ada batas kata di sana (tanpa tumpang-tindih).
 */
function overlapStart(text: string, end: number): number {
  const from = end - CHUNK_OVERLAP;
  if (from < 0) return end;
  const gap = text.slice(from, end).search(/\s/);
  if (gap < 0) return end;
  let next = from + gap;
  while (next < end && /\s/.test(text[next]!)) next++;
  return end - next < MIN_OVERLAP ? end : next;
}

/** Rentang [awal, akhir) tiap potongan di dalam teks yang sudah dirapikan. */
function windows(text: string): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  while (start < text.length) {
    // Sisa yang sedikit lebih panjang dari satu potongan tidak dipecah menjadi potongan ekor yang kecil.
    if (text.length - start <= CHUNK_SIZE * 1.2) {
      out.push([start, text.length]);
      break;
    }
    const end = breakAt(text, start + Math.floor(CHUNK_SIZE / 2), start + CHUNK_SIZE);
    out.push([start, end]);
    start = overlapStart(text, end);
  }
  return out;
}

const SECTION_WORD = /^(bab|pasal|bagian|lampiran)\s+\S/i;

/** Judul bagian pada baris ke-i (baris pendek yang berdiri sendiri sebelum sebuah paragraf), atau null. */
function headingAt(lines: string[], i: number): string | null {
  const line = lines[i]!.trim();
  const markdown = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
  if (markdown) return markdown[1]!;
  if (line.length < 3 || line.length > 80 || !/\p{L}/u.test(line) || /[.,;:?!]$/.test(line)) return null;
  if (i > 0 && lines[i - 1]!.trim() !== '') return null;
  let next = i + 1;
  while (next < lines.length && lines[next]!.trim() === '') next++;
  if (next >= lines.length) return null;
  if (SECTION_WORD.test(line) || (line === line.toUpperCase() && /\p{Lu}{2}/u.test(line))) return line;
  // Baris pendek biasa hanya dianggap judul bila diikuti paragraf yang jelas lebih panjang.
  let following = 0;
  for (; next < lines.length && lines[next]!.trim() !== '' && following < 80; next++) following += lines[next]!.length;
  return following >= 80 ? line : null;
}

/** Semua judul bagian di dalam teks beserta posisi awal barisnya. */
export function findHeadings(text: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  const lines = text.split('\n');
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    const heading = headingAt(lines, i);
    if (heading) out.push({ at, text: heading });
    at += lines[i]!.length + 1;
  }
  return out;
}

const cleanHeading = (heading: string) => heading.replace(/\s+/g, ' ').trim().slice(0, HEADING_MAX) || null;

function chunkSegment(segment: Segment): Chunk[] {
  const text = normalizeText(segment.text);
  if (!text) return [];
  const known = segment.heading ? cleanHeading(segment.heading) : null;
  const headings = known ? [] : findHeadings(text);
  const ranges = windows(text);
  return ranges
    .map(([start, end], i): Chunk => {
      // Judul yang berlaku = judul terakhir sebelum (atau tepat di) awal isi baru potongan ini.
      const fresh = i === 0 ? start : ranges[i - 1]![1] + 2;
      const heading = known ?? headings.findLast((h) => h.at <= fresh)?.text ?? null;
      return { page: segment.page, heading: heading && cleanHeading(heading), text: text.slice(start, end).trim() };
    })
    .filter((chunk) => chunk.text !== '');
}

/**
 * Potong hasil ekstraksi menjadi potongan ±CHUNK_SIZE karakter. Batas halaman selalu menjadi batas potongan;
 * halaman atau teks yang panjang dipecah di batas paragraf/kalimat dengan tumpang-tindih ±CHUNK_OVERLAP.
 */
export function chunkSegments(segments: Segment[]): Chunk[] {
  return segments.flatMap(chunkSegment);
}

/**
 * Gabungkan potongan berurutan dari satu halaman/dokumen (hasil chunkSegments) menjadi teks utuh; bagian
 * tumpang-tindih di awal tiap potongan tidak diulang.
 */
export function joinChunks(parts: string[]): string {
  let out = '';
  for (const part of parts) {
    if (!out) {
      out = part;
      continue;
    }
    // Panjang tumpang-tindih dihitung dengan aturan yang sama seperti saat memotong, lalu dicocokkan.
    const tail = out.slice(-CHUNK_OVERLAP);
    const overlap = tail.slice(overlapStart(tail, tail.length));
    out += overlap && part.startsWith(overlap) ? part.slice(overlap.length) : `\n${part}`;
  }
  return out;
}
