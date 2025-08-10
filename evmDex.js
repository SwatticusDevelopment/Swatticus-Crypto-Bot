// evmDex.js
const cfg = require('./multichainConfig');

function buildPairs(symbols) {
  const s = Array.from(new Set(symbols));
  const out = [];
  for (let i=0;i<s.length;i++) for (let j=i+1;j<s.length;j++) {
    out.push(`${s[i]}/${s[j]}`); out.push(`${s[j]}/${s[i]}`);
  }
  return out;
}

async function fetchPairs() {
  if (cfg.EVM_TOP_TOKENS.length) return buildPairs(cfg.EVM_TOP_TOKENS);
  return ['WETH/USDC','USDC/WETH']; // minimal default
}

module.exports = { fetchPairs };
