import { MEDIA_LIMITS, STICKER_MAX_BYTES, STICKER_SIZE } from '@wa/shared';

export interface PixelArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar tidak bisa dibaca browser.'));
    img.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal memproses gambar.'))), type, quality),
  );
}

function renameExt(name: string, ext: string) {
  return `${name.replace(/\.[^.]+$/, '') || 'gambar'}.${ext}`;
}

/** Potong (dan putar) gambar sesuai area dari react-easy-crop. PNG tetap PNG (transparansi), selain itu JPEG. */
export async function cropImage(file: File, area: PixelArea, rotation = 0): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const rad = (rotation * Math.PI) / 180;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const bw = Math.abs(Math.cos(rad) * w) + Math.abs(Math.sin(rad) * h);
    const bh = Math.abs(Math.sin(rad) * w) + Math.abs(Math.cos(rad) * h);
    const rotated = document.createElement('canvas');
    rotated.width = Math.round(bw);
    rotated.height = Math.round(bh);
    const rctx = rotated.getContext('2d')!;
    rctx.translate(bw / 2, bh / 2);
    rctx.rotate(rad);
    rctx.drawImage(img, -w / 2, -h / 2);

    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(area.width));
    out.height = Math.max(1, Math.round(area.height));
    out.getContext('2d')!.drawImage(rotated, area.x, area.y, area.width, area.height, 0, 0, out.width, out.height);
    const png = file.type === 'image/png';
    const blob = await toBlob(out, png ? 'image/png' : 'image/jpeg', 0.92);
    return new File([blob], renameExt(file.name, png ? 'png' : 'jpg'), { type: blob.type });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * WhatsApp hanya menerima gambar JPG/PNG maks 5 MB. Gambar lain (WebP, GIF, BMP, AVIF) diubah ke JPEG,
 * dan gambar terlalu besar diperkecil sampai muat.
 */
export async function normalizeImage(file: File): Promise<File> {
  const limit = MEDIA_LIMITS.image.maxBytes;
  if ((file.type === 'image/jpeg' || file.type === 'image/png') && file.size <= limit) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let scale = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d')!;
      // JPEG tidak punya transparansi: beri latar putih.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob(canvas, 'image/jpeg', 0.88);
      if (blob.size <= limit) return new File([blob], renameExt(file.name, 'jpg'), { type: 'image/jpeg' });
      scale *= 0.75;
    }
    throw new Error('Gambar terlalu besar untuk WhatsApp (maks 5 MB).');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Buat stiker WhatsApp: WebP 512×512 berlatar transparan, maks 100 KB. */
export async function makeSticker(src: string, area: PixelArea): Promise<Blob> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = STICKER_SIZE;
  canvas.height = STICKER_SIZE;
  const ctx = canvas.getContext('2d')!;
  // Area crop dimasukkan utuh (contain) ke kanvas 512×512 dengan sedikit ruang di tepi, seperti stiker WhatsApp.
  const pad = 16;
  const scale = Math.min((STICKER_SIZE - pad * 2) / area.width, (STICKER_SIZE - pad * 2) / area.height);
  const dw = area.width * scale;
  const dh = area.height * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, area.x, area.y, area.width, area.height, (STICKER_SIZE - dw) / 2, (STICKER_SIZE - dh) / 2, dw, dh);
  for (const quality of [0.92, 0.85, 0.75, 0.65, 0.5, 0.35]) {
    const blob = await toBlob(canvas, 'image/webp', quality);
    if (blob.type !== 'image/webp') throw new Error('Browser ini tidak bisa membuat WebP. Pakai Chrome atau Edge.');
    if (blob.size <= STICKER_MAX_BYTES.static) return blob;
  }
  throw new Error('Gambar terlalu rumit untuk stiker (maks 100 KB). Coba crop bagian yang lebih kecil.');
}
