// rateLimiter.js
const buckets = new Map();
function limiter(key, { rps = 1, burst = 1 } = {}) {
  if (!buckets.has(key)) {
    buckets.set(key, { cap: Math.max(1, burst), tok: Math.max(1, burst), per: 1000/Math.max(0.001, rps), t: Date.now() });
  }
  const b = buckets.get(key);
  return () => new Promise(res => {
    const step = () => {
      const now = Date.now(), dt = now - b.t, add = Math.floor(dt / b.per);
      if (add > 0) { b.tok = Math.min(b.cap, b.tok + add); b.t = now; }
      if (b.tok > 0) { b.tok -= 1; return res(); }
      setTimeout(step, Math.ceil(b.per));
    };
    step();
  });
}
module.exports = { limiter };
