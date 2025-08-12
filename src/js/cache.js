// src/js/cache.js
export class TTLCache {
  constructor({ ttl = 300_000, negTtl = 60_000, max = 1000 } = {}) {
    this.ttl = ttl;
    this.negTtl = negTtl;
    this.max = max;
    this.map = new Map();
  }
  _key(k){ return typeof k === 'string' ? k : JSON.stringify(k); }
  get(k){
    const key = this._key(k);
    const v = this.map.get(key);
    if (!v) return undefined;
    if (v.expires && Date.now() > v.expires) {
      this.map.delete(key);
      return undefined;
    }
    if (v.neg) return null;
    return v.value;
  }
  set(k, value, { ttl = this.ttl } = {}){
    const key = this._key(k);
    if (this.map.size >= this.max) {
      // simple LRU-ish: delete first key
      const first = this.map.keys().next().value;
      if (first) this.map.delete(first);
    }
    this.map.set(key, { value, expires: Date.now() + ttl, neg: false });
  }
  setNeg(k, { ttl = this.negTtl } = {}){
    const key = this._key(k);
    if (this.map.size >= this.max) {
      const first = this.map.keys().next().value;
      if (first) this.map.delete(first);
    }
    this.map.set(key, { value: null, expires: Date.now() + ttl, neg: true });
  }
  del(k){
    const key = this._key(k);
    this.map.delete(key);
  }
  clear(){
    this.map.clear();
  }
}

export const globalCache = new TTLCache({});
