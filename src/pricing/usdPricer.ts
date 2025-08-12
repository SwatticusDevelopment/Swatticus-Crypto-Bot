
import { ethers } from "ethers";
import { getProviderPool } from "../rpc/providerPool";
import type { Prerequisite } from "../types/dex";

const FACTORY_ABI = [
  "function getPair(address,address) view returns (address)",
];

const USD_LIST = (process.env.USD_TOKENS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const FACTORIES = (process.env.UNIV2_FACTORIES || "").split(",").map(s => s.trim()).filter(Boolean);

type CacheVal = { until: number, ok: boolean, reason?: string };
const cache = new Map<string, CacheVal>();
const TTL_NO = Number(process.env.NO_USD_TTL_SEC || 3600);
const TTL_OK = 300;

function key(addr: string) { return `usd:${addr.toLowerCase()}`; }

async function hasPairWithUsd(provider: ethers.JsonRpcProvider, token: string): Promise<boolean> {
  for (const usd of USD_LIST) {
    for (const f of FACTORIES) {
      const fac = new ethers.Contract(f, FACTORY_ABI, provider);
      try {
        const pair = await fac.getPair(token, usd);
        if (pair && pair !== ethers.ZeroAddress) return true;
      } catch {}
    }
  }
  return false;
}

export const hasUsdRoute: Prerequisite = async ({ tokenIn, tokenOut }) => {
  const provider = getProviderPool().pick();
  const tokens = [tokenIn, tokenOut].map(t => t.toLowerCase());

  for (const t of tokens) {
    if (USD_LIST.includes(t)) continue; // already USD-ish
    const k = key(t);
    const now = Date.now();
    const cached = cache.get(k);
    if (cached && cached.until > now) {
      if (!cached.ok) return cached;
      continue;
    }
    const ok = await hasPairWithUsd(provider, t);
    const outcome = ok ? { ok: true } : { ok: false, reason: "no_usd_route" as const };
    cache.set(k, { until: now + (ok ? TTL_OK : TTL_NO) * 1000, ...outcome });
    if (!ok) return outcome;
  }

  return { ok: true };
};
