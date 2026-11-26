import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Download, Expand, ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { INFOGRAPHIC_WIDTH } from '@wa/shared';
import { contentHeight, infographicDocument, infographicFileName, infographicPng } from './infographic';

/**
 * Pratinjau infografis buatan AOS di kartu jawaban. Dokumennya ditampilkan di iframe tanpa izin skrip (sandbox)
 * pada lebar aslinya 1080 px lalu diperkecil, jadi tampilannya sama persis dengan gambar yang dihasilkan.
 */
export function InfographicCard({ html, onAttach }: { html: string; onAttach: (file: File) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLButtonElement>(null);
  const [height, setHeight] = useState(1350);
  const [boxWidth, setBoxWidth] = useState(320);
  const [busy, setBusy] = useState<null | 'attach' | 'download'>(null);
  const [zoom, setZoom] = useState(false);
  const srcDoc = infographicDocument(html);
  const scale = boxWidth / INFOGRAPHIC_WIDTH;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => entry && setBoxWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    setHeight(contentHeight(doc));
    // Tinggi bisa berubah setelah font selesai dimuat.
    void doc.fonts?.ready.then(() => setHeight(contentHeight(doc)));
  };

  const makeFile = async () => new File([await infographicPng(html, height)], infographicFileName(), { type: 'image/png' });

  const run = async (kind: 'attach' | 'download') => {
    setBusy(kind);
    try {
      const file = await makeFile();
      if (kind === 'attach') onAttach(file);
      else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch {
      toast.error('Gagal membuat gambar infografis di browser ini. Coba dengan Chrome atau Edge versi terbaru.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="aos-info">
      <button type="button" className="aos-info-frame" ref={box} style={{ height: height * scale }} onClick={() => setZoom(true)} aria-label="Lihat infografis lebih besar">
        <iframe
          ref={frame}
          title="Infografis AOS"
          sandbox="allow-same-origin"
          srcDoc={srcDoc}
          onLoad={measure}
          tabIndex={-1}
          style={{ width: INFOGRAPHIC_WIDTH, height, transform: `scale(${scale})` }}
        />
      </button>
      <div className="aos-acts">
        <button type="button" className="aos-pill" data-primary="true" disabled={busy !== null} onClick={() => void run('attach')}>
          {busy === 'attach' ? <Loader2 className="animate-spin" /> : <ImagePlus />} Lampirkan ke balasan
        </button>
        <button type="button" className="aos-pill" disabled={busy !== null} onClick={() => void run('download')}>
          {busy === 'download' ? <Loader2 className="animate-spin" /> : <Download />} Unduh
        </button>
        <button type="button" className="aos-pill" onClick={() => setZoom(true)} aria-label="Perbesar">
          <Expand />
        </button>
      </div>
      {zoom && <InfographicZoom srcDoc={srcDoc} height={height} onClose={() => setZoom(false)} />}
    </div>
  );
}

/** Infografis dalam ukuran besar di popup; ditutup dengan klik di luar, tombol ×, atau Esc. */
function InfographicZoom({ srcDoc, height, onClose }: { srcDoc: string; height: number; onClose: () => void }) {
  const [fit, setFit] = useState(() => Math.min(1, (window.innerWidth * 0.92) / INFOGRAPHIC_WIDTH));
  useEffect(() => {
    const onResize = () => setFit(Math.min(1, (window.innerWidth * 0.92) / INFOGRAPHIC_WIDTH));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="media-viewer-overlay fixed inset-0 z-50 bg-black/85" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="media-viewer fixed inset-0 z-50 overflow-y-auto outline-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Infografis AOS</DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="fixed top-3 right-3 z-10 flex size-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-white/15"
            aria-label="Tutup"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
          <div className="media-viewer-item mx-auto my-8 overflow-hidden rounded-lg shadow-2xl" style={{ width: INFOGRAPHIC_WIDTH * fit, height: height * fit }}>
            <iframe
              title="Infografis AOS (besar)"
              sandbox="allow-same-origin"
              srcDoc={srcDoc}
              tabIndex={-1}
              style={{ width: INFOGRAPHIC_WIDTH, height, border: 0, transform: `scale(${fit})`, transformOrigin: '0 0' }}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Tempat infografis selagi AOS masih menuliskannya. */
export function InfographicPending() {
  return (
    <div className="aos-info-pending" role="status">
      <Loader2 className="animate-spin" /> Menyusun infografis…
    </div>
  );
}
