/** A tiny seeded PRNG (mulberry32) whose whole state is one uint32, so it serialises into a save. */
export class Rng {
  state: number;
  constructor(seed: number) { this.state = (seed >>> 0) || 0x9e3779b9; }
  /** Uniform in [0, 1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number) { return Math.floor(this.next() * n); }
  pick<T>(items: readonly T[]) { return items[this.int(items.length)]; }
  /** Weighted pick: an index, or -1 for an empty or all-zero list. */
  weighted(weights: readonly number[]) {
    const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) { r -= Math.max(0, weights[i]); if (r < 0) return i; }
    return weights.length - 1;
  }
  clone() { const copy = new Rng(1); copy.state = this.state; return copy; }
}
