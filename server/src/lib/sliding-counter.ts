/**
 * Penghitung kejadian per kunci dalam jendela waktu (in-memory). Kunci yang sudah tidak punya kejadian
 * dalam jendela dibuang saat jumlah kunci melewati batas, agar map tidak tumbuh tanpa batas.
 */
export class SlidingCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  count(key: string, now = Date.now()): number {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length;
  }

  /** Catat satu kejadian dan kembalikan jumlah kejadian dalam jendela (termasuk yang ini). */
  hit(key: string, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.sweep(now);
    return recent.length;
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  get size(): number {
    return this.hits.size;
  }

  private sweep(now: number) {
    for (const [key, times] of this.hits) {
      if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(key);
    }
  }
}
