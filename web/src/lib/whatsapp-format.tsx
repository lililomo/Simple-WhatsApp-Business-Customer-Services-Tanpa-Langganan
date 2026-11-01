import type { ReactNode } from 'react';

// Format teks WhatsApp: ```blok```, `kode`, *tebal*, _miring_, ~coret~, dan tautan.
// Menghasilkan elemen React (tanpa HTML mentah), jadi isi pesan tidak bisa menyisipkan markup.
interface Rule {
  re: RegExp;
  render: (inner: string, key: string) => ReactNode;
  nested: boolean;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/;

const rules: Rule[] = [
  { re: /```([\s\S]+?)```/, nested: false, render: (s, k) => <code key={k} className="block rounded bg-black/5 px-1.5 py-1 font-mono text-[0.85em] whitespace-pre-wrap dark:bg-white/10">{s}</code> },
  { re: URL_RE, nested: false, render: (s, k) => <a key={k} href={s} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-tick-read underline">{s}</a> },
  { re: /`([^`\n]+)`/, nested: false, render: (s, k) => <code key={k} className="rounded bg-black/5 px-1 font-mono text-[0.85em] dark:bg-white/10">{s}</code> },
  { re: /(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/, nested: true, render: (s, k) => <strong key={k}>{format(s, k)}</strong> },
  { re: /(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])/, nested: true, render: (s, k) => <em key={k}>{format(s, k)}</em> },
  { re: /(?<![\w~])~(?!\s)([^~\n]+?)(?<!\s)~(?![\w~])/, nested: true, render: (s, k) => <s key={k}>{format(s, k)}</s> },
];

export function format(text: string, keyPrefix = 'f'): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest.length > 0) {
    let best: { index: number; match: RegExpExecArray; rule: Rule } | null = null;
    for (const rule of rules) {
      const match = rule.re.exec(rest);
      if (match && (best === null || match.index < best.index)) best = { index: match.index, match, rule };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.index > 0) out.push(rest.slice(0, best.index));
    const inner = best.match[1] ?? best.match[0];
    out.push(best.rule.render(inner, `${keyPrefix}-${n++}`));
    rest = rest.slice(best.index + best.match[0].length);
  }
  return out;
}

export function FormattedText({ text, className }: { text: string; className?: string }) {
  return <span className={className ?? 'whitespace-pre-wrap break-words'}>{format(text)}</span>;
}
