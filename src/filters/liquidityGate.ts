
import { ethers } from "ethers";
import { getProviderPool } from "../rpc/providerPool";
import type { Prerequisite, V2PairLike } from "../types/dex";

// Minimal ABI bits
const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
];
const FACTORY_ABI = [
  "function getPair(address,address) view returns (address)",
];

const WETH = (process.env.WETH || "0x4200000000000000000000000000000000000006").toLowerCase();

const MIN_WETH_LIQ = Number(process.env.MIN_WETH_LIQ || 2);   // in WETH, rough
const CACHE_SEC     = Number(process.env.LIQ_CACHE_SEC || 300);

type CacheVal = { until: number, ok: boolean, reason?: string };
const cache = new Map<string, CacheVal>();

// Optional: if you have a factory map per router, pass it via env (comma-separated)
const FACTORIES = (process.env.UNIV2_FACTORIES || "").split(",").map(s => s.trim()).filter(Boolean);

function key(a: string, b: string) {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `liq:${x}:${y}`;
}

async function getPairAddress(provider: ethers.JsonRpcProvider, tokenA: string, tokenB: string): Promise<string | null> {
  for (const f of FACTORIES) {
    const fac = new ethers.Contract(f, FACTORY_ABI, provider);
    try {
      const addr: string = await fac.getPair(tokenA, tokenB);
      if (addr && addr !== ethers.ZeroAddress) return addr;
    } catch {}
  }
  return null;
}

export const hasSufficientLiquidity: Prerequisite = async ({ tokenIn, tokenOut }) => {
  const k = key(tokenIn, tokenOut);
  const now = Date.now();
  const cached = cache.get(k);
  if (cached && cached.until > now) return cached;

  const provider = getProviderPool().pick();

  // Try to find a pair using known factories.
  const pairAddr = await getPairAddress(provider, tokenIn, tokenOut);
  if (!pairAddr) {
    const outcome = { ok: false, reason: "no_pair_found" as const };
    cache.set(k, { until: now + CACHE_SEC * 1000, ...outcome });
    return outcome;
  }

  const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider) as unknown as V2PairLike;
  let r0: bigint, r1: bigint, t0: string, t1: string;
  try {
    [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);
    const reserves = await pair.getReserves();
    r0 = reserves[0]; r1 = reserves[1];
  } catch {
    const outcome = { ok: false, reason: "reserves_read_failed" as const };
    cache.set(k, { until: now + 60_000, ...outcome });
    return outcome;
  }

  // If the pair involves WETH, approximate WETH liquidity.
  let wethRes = 0;
  if (t0.toLowerCase() === WETH) wethRes = Number(r0) / 1e18;
  if (t1.toLowerCase() === WETH) wethRes = Math.max(wethRes, Number(r1) / 1e18);

  if (wethRes > 0 && wethRes < MIN_WETH_LIQ) {
    const outcome = { ok: false, reason: "low_weth_liquidity" as const };
    cache.set(k, { until: now + CACHE_SEC * 1000, ...outcome });
    return outcome;
  }

  // Non-WETH pair: require non-zero reserves to avoid dust.
  if (wethRes === 0 && (r0 === 0n || r1 === 0n)) {
    const outcome = { ok: false, reason: "zero_reserves" as const };
    cache.set(k, { until: now + CACHE_SEC * 1000, ...outcome });
    return outcome;
  }

  const outcome = { ok: true };
  cache.set(k, { until: now + CACHE_SEC * 1000, ...outcome });
  return outcome;
};
