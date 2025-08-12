// scripts/generatePairs.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

(async () => {
  const outPath = process.env.EVM_PAIRS_OUT || path.resolve(process.cwd(), 'pairs.base.json');
  const t0 = Date.now();
  try {
    console.log('[pairs] start');
    if (!process.env.EVM_RPC_URL) throw new Error('EVM_RPC_URL missing');
    if (!process.env.EVM_CHAIN_ID) process.env.EVM_CHAIN_ID = '8453';

    const { discoverPairs } = require('../src/js/discoverPairs');
    const pairs = await discoverPairs({ exclude: process.env.EVM_PAIR_EXCLUDE });

    fs.writeFileSync(outPath, JSON.stringify(pairs, null, 2));
    console.log(`[pairs] wrote ${pairs.length} pairs -> ${outPath}`);
    console.log(`[pairs] done in ${(Date.now()-t0)/1000}s`);
  } catch (e) {
    console.error('[pairs] discovery failed:', e?.message || e);
    process.exit(1);
  }
})();
