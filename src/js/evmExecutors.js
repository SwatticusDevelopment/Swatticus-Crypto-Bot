// src/js/evmExecutors.js - UPDATED to support BaseSwap
const { ethers } = require('ethers');
const cfg = require('./multichainConfig');
const { execBaseSwap } = require('./baseSwapRouters');

function provider(){ return new ethers.JsonRpcProvider(cfg.EVM_RPC_URL, cfg.EVM_CHAIN_ID); }
function wallet(){ return new ethers.Wallet(cfg.EVM_PRIVATE_KEY, provider()); }

async function execByRouter(chainId, routerName, normQuote, pair, estNetUsd) {
  console.log(`[exec] Executing trade via ${routerName} for ${pair}`);
  console.log(`[exec] Estimated profit: $${estNetUsd}`);
  
  if (routerName === 'baseswap') {
    return await execBaseSwap(normQuote, pair, estNetUsd);
  }
  
  console.log(`[exec] Unsupported router: ${routerName}`);
  return { 
    success: false, 
    txHash: '', 
    error: `Unsupported router: ${routerName}` 
  };
}

module.exports = { execByRouter };