// evmSwap.js
const { ethers } = require('ethers');
const cfg = require('./multichainConfig');

function provider() { return new ethers.providers.JsonRpcProvider(cfg.EVM_RPC_URL, cfg.EVM_CHAIN_ID); }
function wallet() { return new ethers.Wallet(cfg.EVM_PRIVATE_KEY, provider()); }

async function execute0x(quote) {
  const w = wallet();
  const tx = {
    to: quote.to,
    data: quote.data,
    value: ethers.BigNumber.from(quote.value || '0'),
    gasLimit: quote.gas ? ethers.BigNumber.from(quote.gas) : undefined,
  };
  const sent = await w.sendTransaction(tx);
  const rec = await sent.wait();
  return { success: rec.status === 1, txHash: rec.transactionHash };
}

async function execute(quote, router) {
  if (router === '0x') return execute0x(quote);
  return { success: false, txHash: '' };
}

module.exports = { execute };
