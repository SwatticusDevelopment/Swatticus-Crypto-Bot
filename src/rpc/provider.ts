
import { JsonRpcProvider, Network } from "ethers";

// Simple gate to avoid RPC bursts.
class Gate {
  private current = 0;
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.current >= this.max) {
      await new Promise(r => setTimeout(r, 5));
    }
    this.current++;
    try { return await fn(); } finally { this.current--; }
  }
}

const jitter = (ms: number) => ms + Math.floor(Math.random() * 50);

function isRateLimit(e: any) {
  const m = (e && (e.message || e.reason || "")) as string;
  return e?.code === 429 || /compute units per second/i.test(m) || /rate/i.test(m);
}

export async function rpcCall<T>(fn: () => Promise<T>, label = "rpc", retries = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e: any) {
      lastErr = e;
      const backoff = jitter(200 * Math.pow(2, i));
      if (isRateLimit(e) && i < retries) {
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      // Bubble up for the caller to decide (do NOT convert to "no pool")
      throw e;
    }
  }
  throw lastErr;
}

export type ChainConfig = {
  name: string;
  chainId: number;
  urls: string[];
  concurrency: number;
};

const baseUrls = (process.env.BASE_RPC_URLS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const CHAINS: Record<number, ChainConfig> = {
  8453: { name: "base", chainId: 8453, urls: baseUrls, concurrency: 6 },
};

const gates: Record<string, Gate> = {};

function pickUrl(urls: string[]): string {
  // naive rotation; callers keep provider short‑lived or memoize externally
  const idx = Math.floor(Math.random() * urls.length);
  return urls[idx];
}

/**
 * JsonRpcProvider pinned to Base (static network) so ethers **does not** call eth_chainId at startup.
 * If you pass a number or Network object, ethers v6 will not "detect" network.
 */
export function getBaseProvider(): JsonRpcProvider {
  const cfg = CHAINS[8453];
  if (!cfg || cfg.urls.length === 0) {
    throw new Error("No RPC URLs configured. Set BASE_RPC_URLS (comma-separated).");
  }
  const url = pickUrl(cfg.urls);
  const provider = new JsonRpcProvider(url, new Network(8453, cfg.name));
  const key = `${cfg.chainId}:${new URL(url).host}`;
  if (!gates[key]) gates[key] = new Gate(cfg.concurrency);
  // monkey-patch a lightweight gate for .call-heavy flows
  (provider as any).__gate = gates[key];
  return provider;
}

export async function gated<T>(provider: JsonRpcProvider, fn: () => Promise<T>): Promise<T> {
  const gate: Gate | undefined = (provider as any).__gate;
  if (!gate) return await fn();
  return gate.run(fn);
}
