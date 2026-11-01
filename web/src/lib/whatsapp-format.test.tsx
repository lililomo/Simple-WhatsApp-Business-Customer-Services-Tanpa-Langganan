import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormattedText } from './whatsapp-format';

const html = (text: string) => render(<FormattedText text={text} />).container.innerHTML;

describe('WhatsApp formatting', () => {
  it('renders bold, italic, strike and code', () => {
    expect(html('*Tebal* _miring_ ~coret~ ```kode```')).toBe(
      '<span class="whitespace-pre-wrap break-words"><strong>Tebal</strong> <em>miring</em> <s>coret</s> <code class="block rounded bg-black/5 px-1.5 py-1 font-mono text-[0.85em] whitespace-pre-wrap dark:bg-white/10">kode</code></span>',
    );
  });

  it('does not treat underscores inside words or URLs as italics', () => {
    const out = html('file_nama_baru lihat https://pajak.go.id/a_b_c.');
    expect(out).not.toContain('<em>');
    expect(out).toContain('href="https://pajak.go.id/a_b_c"');
  });

  it('escapes markup instead of rendering it', () => {
    expect(html('<img src=x onerror=alert(1)>')).toContain('&lt;img');
  });
});
