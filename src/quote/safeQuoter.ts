
import { isRouterWeirdRevert, isInsufficientLiquidity } from "../rpc/errors";
import type { Prerequisite, RouterLike } from "../types/dex";

type Cfg = {
  quoter: (router: RouterLike, amountIn: bigint, path: string[]) => Promise<bigint[]>;
  prerequisites?: Prerequisite[];
  retries?: number;
};

export function makeSafeQuoter(cfg: Cfg) {
  const prereqs = cfg.prerequisites || [];
  const maxRetry = cfg.retries ?? Number(process.env.QUOTE_RETRY || 2);

  return async function safeQuote(router: RouterLike, amountIn: bigint, path: string[], meta?: { tokenIn: string, tokenOut: string }) {
    const tokenIn = meta?.tokenIn || path[0];
    const tokenOut = meta?.tokenOut || path[path.length - 1];

    // prerequisites
    for (const p of prereqs) {
      const r = await p({ tokenIn, tokenOut, router });
      if (!r.ok) {
        throw new Error(`precheck:${r.reason || "failed"}`);
      }
    }

    let lastErr: any;
    for (let i = 0; i <= maxRetry; i++) {
      try {
        return await cfg.quoter(router, amountIn, path);
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || e);
        if (isInsufficientLiquidity(e) || /precheck:/.test(msg)) {
          // Don't retry these
          break;
        }
        if (isRouterWeirdRevert(e)) {
          // backoff a bit and retry
          await new Promise(r => setTimeout(r, 200 + Math.random()*300));
          continue;
        }
        // single retry on other unknown errors
        if (i < maxRetry) {
          await new Promise(r => setTimeout(r, 150));
          continue;
        }
      }
    }
    throw lastErr;
  };
}
