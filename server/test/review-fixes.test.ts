import { describe, expect, it } from 'vitest';
import { fulltextQuery } from '../src/modules/conversations/queries';
import { SlidingCounter } from '../src/lib/sliding-counter';

describe('SlidingCounter', () => {
  it('counts within the window and forgets stale keys', () => {
    const c = new SlidingCounter(1000, 3);
    expect(c.hit('a', 0)).toBe(1);
    expect(c.hit('a', 500)).toBe(2);
    expect(c.count('a', 1600)).toBe(0);
    c.hit('b', 2000);
    c.hit('c', 2000);
    c.hit('d', 2000);
    c.hit('e', 2000); // melewati batas kunci → kunci lama dibuang
    expect(c.size).toBeLessThanOrEqual(4);
    expect(c.count('a', 2000)).toBe(0);
  });
});

describe('fulltextQuery', () => {
  it('builds a prefix boolean query and drops short or operator characters', () => {
    expect(fulltextQuery('NPWP saya +hilang')).toBe('+npwp* +saya* +hilang*');
    expect(fulltextQuery('di ke')).toBeNull();
    expect(fulltextQuery('"spt" (2025)')).toBe('+spt* +2025*');
  });
});
