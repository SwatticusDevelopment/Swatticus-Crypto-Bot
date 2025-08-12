
import { JsonRpcProvider, FallbackProvider } from "ethers";

/**
 * Minimal async rate limiter for provider.send
 */
class SimpleLimiter {
  constructor(minTimeMs = 120) {
    this.minTimeMs = minTimeMs;
    this.queue = [];
    this.running = false;
  }
  schedule(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.#run();
    });
  }
  async #run() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const { fn, resolve, reject } = this.queue.shift();
      try {
        const res = await fn();
        resolve(res);
      } catch (e) {
        reject(e);
      }
      await new Promise((r) => setTimeout(r, this.minTimeMs));
    }
    this.running = false;
  }
}

/**
 * Create a static, rate-limited FallbackProvider for Base (chainId 8453)
 * @param {string[]} urls
 * @param {{ chainId?: number, name?: string, stallTimeout?: number, minTimeMs?: number }} opts
 */
export function makeProvider(urls, opts = {}) {
  const {
    chainId = 8453,
    name = "base",
    stallTimeout = 750,
    minTimeMs = 120,
  } = opts;

  if (!Array.isArray(urls) || urls.length === 0 || !urls[0]) {
    throw new Error("makeProvider: provide at least one RPC URL");
  }

  const providers = urls
    .filter(Boolean)
    .map((u, i) => new JsonRpcProvider(u, { chainId, name }));

  const fp = new FallbackProvider(
    providers.map((p, i) => ({
      provider: p,
      priority: i + 1,
      stallTimeout,
    })),
    1
  );

  // Rate-limit the low-level JSON-RPC send
  const limiter = new SimpleLimiter(minTimeMs);
  const _send = fp.send.bind(fp);
  fp.send = (method, params) => limiter.schedule(() => _send(method, params));

  // Useful defaults
  fp.polling = true;

  return fp;
}
