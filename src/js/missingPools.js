
/**
 * Negative cache for "no pool found" results.
 * Stores canonical (sorted, lowercased) pair keys with a TTL.
 */
export class NegativePoolCache {
  constructor({ ttlMs = 3 * 60 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.map = new Map(); // key -> expiresAt
  }

  static key(tokenA, tokenB, fee) {
    const a = tokenA.toLowerCase();
    const b = tokenB.toLowerCase();
    const [t0, t1] = a < b ? [a, b] : [b, a];
    return `${t0}/${t1}@${fee}`;
  }

  has(key) {
    const exp = this.map.get(key);
    if (!exp) return false;
    if (Date.now() > exp) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  miss(key) {
    this.map.set(key, Date.now() + this.ttlMs);
  }

  sweep() {
    const now = Date.now();
    for (const [k, exp] of this.map.entries()) {
      if (now > exp) this.map.delete(k);
    }
  }
}
