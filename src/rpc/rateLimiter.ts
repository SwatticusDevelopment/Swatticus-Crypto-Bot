
type Task<T> = () => Promise<T>;

export class RateLimiter {
  private readonly maxRps: number;
  private readonly intervalMs: number;
  private readonly maxConcurrency: number;
  private queue: Array<{run: Task<any>, resolve: (v:any)=>void, reject: (e:any)=>void}> = [];
  private inFlight = 0;
  private tokens: number;
  private lastRefill = Date.now();

  constructor({
    maxRps = Number(process.env.RPC_MAX_RPS || 20),
    intervalMs = Number(process.env.RPC_INTERVAL_MS || 1000),
    maxConcurrency = Number(process.env.RPC_MAX_CONCURRENCY || 12),
  } = {}) {
    this.maxRps = maxRps;
    this.intervalMs = intervalMs;
    this.maxConcurrency = maxConcurrency;
    this.tokens = maxRps;
    setInterval(() => this.refill(), Math.ceil(intervalMs / 2));
  }

  private refill() {
    const now = Date.now();
    if (now - this.lastRefill >= this.intervalMs) {
      this.tokens = this.maxRps;
      this.lastRefill = now;
      this.drain();
    }
  }

  private drain() {
    while (this.tokens > 0 && this.inFlight < this.maxConcurrency && this.queue.length) {
      const item = this.queue.shift()!;
      this.tokens--;
      this.inFlight++;
      item.run().then(v => item.resolve(v)).catch(e => item.reject(e)).finally(() => {
        this.inFlight--;
        this.drain();
      });
    }
  }

  schedule<T>(task: Task<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ run: task, resolve, reject });
      this.drain();
    });
  }
}
