// dynamicUniverse.js
// Builds symbols/pairs dynamically for Solana via Jupiter. EVM handled elsewhere.
const fetch = require('node-fetch');

const PRESET = ['SOL/USDC','USDC/SOL','SOL/USDT','USDT/SOL'];

async function fetchJupiterTokens(url) {
  try {
    const r = await fetch(url); if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    return data.filter(t => (t?.daily_volume || 0) > 10000).slice(0, 150);
  } catch { return []; }
}

function pairsFrom(tokens) {
  const bases = ['SOL','USDC','USDT'];
  const out = new Set(PRESET);
  for (const b of bases) {
    for (const t of tokens) {
      if (t.symbol && t.symbol !== b) {
        out.add(`${b}/${t.symbol}`); out.add(`${t.symbol}/${b}`);
      }
    }
  }
  return Array.from(out);
}

async function buildUniverse(cfg) {
  const url = (cfg && cfg.JUPITER_TOKENS_URL) || 'https://quote-api.jup.ag/v6/tokens';
  const tokens = await fetchJupiterTokens(url);
  return tokens.length ? pairsFrom(tokens) : PRESET;
}

module.exports = { buildUniverse };
