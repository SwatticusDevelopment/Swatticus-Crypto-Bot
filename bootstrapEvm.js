// bootstrapEvm.js
// Starts EVM worker using env config.
const cfg = require('./multichainConfig');
const { fetchPairs } = require('./evmDex');
const { startChainWorker } = require('./chainWorker');

(async () => {
  if (!cfg.USE_EVM) return;
  const pairs = await fetchPairs();
  const amountWei = process.env.BASE_TRADE_WEI || '10000000000000000'; // 0.01 WETH example
  startChainWorker(cfg.EVM_RPC_URL, cfg.EVM_CHAIN_ID, pairs, amountWei);
})();
