// index.js
// Clean entrypoint for the multichain slippage bot.
// Loads env, starts unified bootstrap (EVM + optional Sol), and wires basic process handlers.

require('dotenv').config();

// Switch to the clean_patch bootstrap. This starts:
// - EVM worker(s) based on .env
// - Solana placeholder (if USE_SOL=true)
// - Optional modules (profit guard, rollover scheduler, multi-router exec, flashbots stub)
require('./clean_patch/bootstrapAll');

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err && err.stack ? err.stack : err);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});

console.log('[boot] started via index.js -> clean_patch/bootstrapAll');
