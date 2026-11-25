import { AosGlyph, CloseIcon } from './AosLogo';

/** Tombol pembuka memakai tulisan "Asisten OSing" di samping ikon (false = ikon bulat saja). */
const LABELED = true;

/**
 * Tombol pembuka AOS di pojok kanan bawah ruang chat: navy dengan lengkung Gajah Oling (berbentuk pil bertulisan
 * "Asisten OSing" bila LABELED), menjadi lingkaran emas bertanda silang saat panel terbuka. Titik emas dan keterangan
 * muncul bila ada tawaran yang belum dilihat.
 */
export function AosLauncher({ open, offer, onToggle }: { open: boolean; offer: boolean; onToggle: () => void }) {
  const hint = offer && !open;
  return (
    <div className="aos-launcher" data-open={open} data-labeled={LABELED}>
      {hint && (
        <button type="button" className="aos-tip" onClick={onToggle}>
          AOS punya tawaran
        </button>
      )}
      <button
        type="button"
        className="aos-fab"
        aria-label={open ? 'Tutup AOS' : 'Buka AOS'}
        aria-expanded={open}
        title={open ? 'Tutup AOS' : 'Asisten OSing (AOS)'}
        onClick={onToggle}
      >
        {open ? <CloseIcon /> : <AosGlyph />}
        {!open && (
          <span className="aos-fab-label" aria-hidden="true">
            Asisten OSing
          </span>
        )}
      </button>
      {hint && <span className="aos-badge" />}
    </div>
  );
}
