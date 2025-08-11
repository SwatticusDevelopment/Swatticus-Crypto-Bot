// launcher.js - EXE entry (pkg). Generates pairs then starts index.js
const path = require('path');
const fs = require('fs');

const baseDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
require('dotenv').config({ path: path.join(baseDir, '.env') });

process.env.EVM_PAIRS_FILE = process.env.EVM_PAIRS_FILE || path.join(baseDir, 'pairs.base.json');

(async () => {
  const { discoverPairs } = require('./src/js/discoverPairs');
  const pairs = await discoverPairs({ exclude: process.env.EVM_PAIR_EXCLUDE });
  fs.writeFileSync(process.env.EVM_PAIRS_FILE, JSON.stringify(pairs, null, 2));
  console.log(`[pairs] wrote ${pairs.length} -> ${process.env.EVM_PAIRS_FILE}`);

  require('./index');
})();
