import { useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface AspectOption {
  label: string;
  value: number | undefined;
}

export const PHOTO_ASPECTS: AspectOption[] = [
  { label: 'Bebas', value: undefined },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
];

/** Editor crop: geser/zoom gambar, pilih rasio, putar 90°. */
export function CropEditor({
  src,
  aspects = PHOTO_ASPECTS,
  rotatable = true,
  round = false,
  applyLabel = 'Terapkan',
  busy = false,
  onCancel,
  onApply,
}: {
  src: string;
  aspects?: AspectOption[];
  rotatable?: boolean;
  round?: boolean;
  applyLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onApply: (area: Area, rotation: number) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState(aspects[0]!.value);
  const [area, setArea] = useState<Area | null>(null);
  // Mode "Bebas": kotak crop mengikuti rasio gambar; pengguna menyesuaikan dengan zoom dan geser.
  const [naturalAspect, setNaturalAspect] = useState(1);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative min-h-72 flex-1 overflow-hidden rounded-xl bg-black/90">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect ?? naturalAspect}
          cropShape={round ? 'round' : 'rect'}
          showGrid={!round}
          minZoom={0.5}
          maxZoom={5}
          restrictPosition={false}
          objectFit="contain"
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, pixels) => setArea(pixels)}
          onMediaLoaded={(m) => setNaturalAspect(m.naturalWidth / m.naturalHeight)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {aspects.length > 1 &&
          aspects.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => setAspect(a.value)}
              className={cn('rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent', aspect === a.value && 'border-gold bg-gold text-gold-foreground hover:bg-gold-hover')}
            >
              {a.label}
            </button>
          ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          Zoom
          <input type="range" min={0.5} max={5} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-28 accent-[var(--gold)]" />
        </label>
        {rotatable && (
          <Button type="button" variant="outline" size="icon-sm" aria-label="Putar 90°" onClick={() => setRotation((r) => (r + 90) % 360)}>
            <RotateCw />
          </Button>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Batal
        </Button>
        <Button type="button" disabled={!area || busy} onClick={() => area && onApply(area, rotation)}>
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}
