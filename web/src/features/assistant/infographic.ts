import { INFOGRAPHIC_WIDTH } from '@wa/shared';
import latinFont from '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2?url';
import latinExtFont from '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-wght-normal.woff2?url';

/**
 * Infografis AOS: Claude menulis dokumen HTML+CSS sendiri; di sini dokumen itu ditampilkan (iframe tanpa skrip) dan
 * digambar menjadi PNG di browser petugas. Tidak ada yang dijalankan di server.
 */

const MAX_HEIGHT = 4000;
const FAMILY = 'Plus Jakarta Sans';

const fontFace = (src: (url: string) => string) =>
  [latinFont, latinExtFont]
    .map((url) => `@font-face{font-family:'${FAMILY}';font-style:normal;font-weight:200 800;font-display:block;src:${src(url)} format('woff2');}`)
    .join('');

/** Gaya dasar yang disisipkan sebelum gaya buatan model: font tersedia, tanpa margin, lebar kanvas tetap. */
const baseStyle = (fonts: string) =>
  `${fonts}html,body{margin:0;padding:0;}body{width:${INFOGRAPHIC_WIDTH}px;font-family:'${FAMILY}',sans-serif;-webkit-font-smoothing:antialiased;}*{box-sizing:border-box;}`;

/** Dokumen lengkap untuk iframe pratinjau. Model biasanya menulis dokumen utuh; potongan HTML juga diterima. */
export function infographicDocument(html: string, fonts = fontFace((url) => `url('${new URL(url, document.baseURI).href}')`)): string {
  const style = `<style>${baseStyle(fonts)}</style>`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1><meta charset="utf-8">${style}`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head><meta charset="utf-8">${style}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${html}</body></html>`;
}

/** Tinggi isi dokumen di iframe, dibatasi agar gambar tidak kebablasan panjangnya. */
export function contentHeight(doc: Document): number {
  const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
  return Math.min(MAX_HEIGHT, Math.max(200, Math.ceil(h)));
}

let embeddedFonts: Promise<string> | null = null;

async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Gagal membaca font'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Gambar SVG tidak boleh memuat font dari luar dirinya, jadi font disematkan sebagai data URL (sekali per halaman).
 * Font yang sama dimuat dulu lewat FontFace supaya sudah terurai saat gambar pertama digambar.
 */
function fontsForImage(): Promise<string> {
  embeddedFonts ??= Promise.all([latinFont, latinExtFont].map(dataUrl))
    .then(async (sources) => {
      await Promise.all(sources.map((src) => new FontFace(`${FAMILY} AOS`, `url('${src}')`).load().catch(() => undefined)));
      return sources.map((src) => `@font-face{font-family:'${FAMILY}';font-style:normal;font-weight:200 800;src:url('${src}') format('woff2');}`).join('');
    })
    .catch((err: unknown) => {
      embeddedFonts = null;
      throw err;
    });
  return embeddedFonts;
}

/**
 * Menggambar infografis menjadi PNG: dokumen yang sudah dirender di iframe diserialisasi menjadi XHTML, dibungkus
 * <foreignObject> di dalam SVG, lalu digambar ke kanvas. Teknik yang sama dipakai pustaka "html-to-image".
 */
export async function infographicPng(html: string, height: number, scale = 1): Promise<Blob> {
  const fonts = await fontsForImage();
  const parsed = new DOMParser().parseFromString(infographicDocument(html, fonts), 'text/html');
  parsed.querySelectorAll('script').forEach((node) => node.remove());
  const xhtml = new XMLSerializer().serializeToString(parsed.documentElement);
  const width = INFOGRAPHIC_WIDTH;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;

  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const load = async () => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  };
  // Pada gambar pertama di sebuah halaman, font di dalam SVG bisa belum siap saat gambar selesai diurai dan teksnya
  // tidak tergambar (terlihat di Chrome). Gambar diurai sekali untuk memuat fontnya, lalu diurai lagi untuk dipakai.
  await load();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const image = await load();

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung kanvas.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Gagal membuat gambar.'))), 'image/png'),
  );
}

/** Nama berkas yang enak dibaca, mis. "infografis-aos-20261126-0930.png". */
export function infographicFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `infografis-aos-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.png`;
}
