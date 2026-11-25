import type { SVGProps } from 'react';

// Ikon AOS: lengkung motif Gajah Oling dengan kilau. Bentuknya sama dengan docs/mockup-aos.html.
const CURL = 'M15 35c-5-9-.5-21 10-22 8-.8 13.5 5 12.5 11.5-.9 5.5-6.5 8.5-11 6.5-3.5-1.6-4.5-6-2-8.3 1.8-1.7 4.8-1 5.3 1.4';
const GLINT = 'M36.5 6l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z';
const NAVY = '#212C5F';
const GOLD = '#FFC91B';

function Glyph() {
  return (
    <>
      <path d={CURL} fill="none" stroke={GOLD} strokeWidth="3.4" strokeLinecap="round" />
      <path d={GLINT} fill={GOLD} />
    </>
  );
}

/** Logo lengkap: lingkaran navy dengan lengkung emas (kepala panel dan avatar gelembung). */
export function AosLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
      <circle cx="24" cy="24" r="24" fill={NAVY} />
      <Glyph />
    </svg>
  );
}

/** Lengkungnya saja, untuk tombol pembuka yang sudah berlatar navy. */
export function AosGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
      <Glyph />
    </svg>
  );
}

/** Kilau kecil di baris daftar chat: AOS punya tawaran untuk percakapan itu. */
export function AosSpark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="AOS punya tawaran" {...props}>
      <title>AOS punya tawaran</title>
      <path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z" />
    </svg>
  );
}

const line = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', 'aria-hidden': true } as const;

// Ikon kepala panel dan kotak tanya, digambar seperti di mockup (garis 1.8, sudut membulat).
export function HelpIcon() {
  return (
    <svg {...line} strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.6a2.4 2.4 0 1 1 3.5 2.1c-.7.4-1.1.9-1.1 1.8M12 17h.01" />
    </svg>
  );
}

export function MinimizeIcon() {
  return (
    <svg {...line} strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function ResizeIcon() {
  return (
    <svg {...line} strokeWidth="1.8" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M13 7h4v4M17 7l-4 4M11 17H7v-4M7 17l4-4" />
    </svg>
  );
}

export function NewTopicIcon() {
  return (
    <svg {...line} strokeWidth="1.8">
      <path d="M12 3.5v7" />
      <path d="M7 6.2a8.2 8.2 0 1 0 10 0" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg {...line} strokeWidth="2" strokeLinejoin="round">
      <path d="M21 3L10.5 13.5M21 3l-6.5 18-4-7.5-7.5-4z" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...line} strokeWidth="2.6">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
