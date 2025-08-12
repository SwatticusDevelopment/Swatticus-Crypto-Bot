// src/js/bootstrapAll.js
require('dotenv').config();
const server = require('./dashboardServer');

(function enforcePk(){
  let pk = (process.env.EVM_PRIVATE_KEY || '').trim().replace(/^"(.*)"$/,'$1').replace(/^'(.*)'$/,'$1');
  if (pk && !pk.startsWith('0x')) pk = '0x' + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('EVM_PRIVATE_KEY must be 0x + 64 hex chars (no quotes/spaces).');
  }
  process.env.EVM_PRIVATE_KEY = pk;
})();

// --- Auto-start the bot on process boot ---
try {
  const { start } = require('./chainWorker');
  const auto = String(process.env.AUTO_START || 'true').toLowerCase();
  if (auto === 'true' || auto === '1' || auto === 'yes') {
    const res = start();
    console.log('[boot] auto-start:', res);
  } else {
    console.log('[boot] auto-start disabled (set AUTO_START=true to enable)');
  }
} catch (e) {
  console.error('[boot] auto-start failed:', e?.message || e);
}
