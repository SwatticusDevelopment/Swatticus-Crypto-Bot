// universeMulti.js
const cfg = require('./multichainConfig');
const { buildUniverse } = require('./dynamicUniverse');
const { fetchPairs: evmPairs } = require('./evmDex');

async function buildMultiUniverse() {
  const out = [];
  if (cfg.USE_SOL) {
    const sol = await buildUniverse(cfg);
    out.push(...sol.map(p => ({ chain: 'sol', pair: p })));
  }
  if (cfg.USE_EVM) {
    const evm = await evmPairs();
    out.push(...evm.map(p => ({ chain: 'evm', pair: p })));
  }
  return out;
}

module.exports = { buildMultiUniverse };
