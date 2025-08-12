// ESM module
// Hardened provider for Base: static network + RPC rate limiting + optional fallback across multiple HTTP URLs.
// Drop-in replacement for your existing provider.js

import { JsonRpcProvider, FallbackProvider } from "ethers";
import Bottleneck from "bottleneck";

const network = { chainId: 8453, name: "base" };

const urls = [
  process.env.RPC_URL,
  process.env.RPC_URL_2,
  process.env.RPC_URL_3,
].filter(Boolean);

if (urls.length === 0) {
  throw new Error("RPC_URL is required");
}

// Only use HTTP endpoints here; disable WS for now to avoid double eth_chainId probes.
const providers = urls.map((url) => new JsonRpcProvider(url, network));

// quorum = 1 (first that responds). All children are static to Base, so no network-detect loop.
const baseProvider =
  providers.length === 1
    ? providers[0]
    : new FallbackProvider(providers.map((p) => ({ provider: p, weight: 1 })), 1);

// ---- Throttle & burst control -------------------------------------------------
const tokensPerSec = Number(process.env.RPC_TOKENS_PER_SEC ?? 10); // Alchemy free tier: keep conservative
const minTime = Number(process.env.RPC_MIN_TIME_MS ?? 120);
const maxConc = Number(process.env.RPC_MAX_CONCURRENT ?? 1);

const limiter = new Bottleneck({
  reservoir: tokensPerSec,
  reservoirRefreshAmount: tokensPerSec,
  reservoirRefreshInterval: 1000,
  minTime,
  maxConcurrent: maxConc,
});

const rawSend = baseProvider.send.bind(baseProvider);
baseProvider.send = (method, params) => {
  // Eth providers love to spam eth_chainId when network isn't static. We made it static,
  // but still throttle everything uniformly to smooth CPU bursts at the RPC.
  return limiter.schedule(() => rawSend(method, params));
};

export default baseProvider;
