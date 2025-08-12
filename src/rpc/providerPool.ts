
import { ethers } from "ethers";
import { RateLimiter } from "./rateLimiter";
import { isRateLimit, isNetworkish, TransientRpcError } from "./errors";

export type RpcPool = {
  send: (method: string, params?: any[]) => Promise<any>;
  pick: () => ethers.JsonRpcProvider;
  size: number;
};

let singleton: RpcPool | null = null;

export function getProviderPool(): RpcPool {
  if (singleton) return singleton;

  const urls = [process.env.RPC_URL, process.env.RPC_URL_2, process.env.RPC_URL_3]
    .filter(Boolean) as string[];
  if (urls.length === 0) {
    throw new Error("No RPC_URL provided");
  }

  const providers = urls.map((u) => new ethers.JsonRpcProvider(u));
  const limiter = new RateLimiter();
  let rr = 0;

  async function _send(method: string, params: any[] = [], attempt = 0): Promise<any> {
    return limiter.schedule(async () => {
      const idx = rr++ % providers.length;
      const p = providers[idx];
      try {
        return await p.send(method, params);
      } catch (e: any) {
        // Retry on transient/429
        if (attempt < 4 && (isRateLimit(e) || isNetworkish(e))) {
          const backoff = Math.min(500 * Math.pow(2, attempt) + Math.random() * 250, 5000);
          await new Promise(r => setTimeout(r, backoff));
          return _send(method, params, attempt + 1);
        }
        // Try the next provider once
        if (attempt < providers.length - 1) {
          return _send(method, params, attempt + 1);
        }
        throw new TransientRpcError(e?.message || String(e));
      }
    });
  }

  singleton = {
    send: _send,
    pick: () => providers[rr++ % providers.length],
    size: providers.length,
  };
  return singleton;
}
