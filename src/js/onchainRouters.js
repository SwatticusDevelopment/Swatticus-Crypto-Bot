// src/js/onchainRouters.js - FIXED VERSION (skip broken Quoter)
const { ethers } = require('ethers');
const cfg = require('./multichainConfig');
const { spotAmountOut } = require('./v3Spot');

function provider(){ return new ethers.JsonRpcProvider(cfg.EVM_RPC_URL, cfg.EVM_CHAIN_ID); }

// Since the Quoter is broken on Base, we'll use our working v3Spot calculation
async function quoteUniV3(tokenIn, tokenOut, fee, amountIn){
  console.log(`[quote] Getting UniV3 quote via slot0 (Quoter bypass)`);
  console.log(`[quote] ${tokenIn} -> ${tokenOut}, fee: ${fee}, amount: ${amountIn.toString()}`);
  
  try {
    // Use our working spot calculation instead of the broken Quoter
    const estimatedOut = await spotAmountOut(tokenIn, tokenOut, fee, amountIn);
    
    console.log(`[quote] Estimated output: ${estimatedOut}`);
    
    return { 
      router: 'univ3', 
      buyAmount: estimatedOut.toString(), 
      sellToken: tokenIn, 
      buyToken: tokenOut, 
      sellAmount: amountIn.toString(), 
      fee: fee 
    };
    
  } catch (e) {
    console.log(`[quote] UniV3 quote failed: ${e.message}`);
    throw e;
  }
}

// V2 router quotes (if needed)
const ROUTER_V2_ABI = ['function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'];

async function quoteUniV2(tokenIn, tokenOut, path, amountIn){
  if (!cfg.UNI_V2_ROUTER || !ethers.isAddress(cfg.UNI_V2_ROUTER)) { 
    throw new Error('UNI_V2_ROUTER not set or invalid'); 
  }
  
  const pth = (path && path.length >= 2) ? path : [tokenIn, tokenOut];
  const r = new ethers.Contract(cfg.UNI_V2_ROUTER, ROUTER_V2_ABI, provider());
  
  try {
    const amounts = await r.getAmountsOut(amountIn, pth);
    const amountOut = amounts[amounts.length - 1];
    
    return { 
      router: 'univ2', 
      buyAmount: amountOut.toString(), 
      sellToken: tokenIn, 
      buyToken: tokenOut, 
      sellAmount: amountIn.toString(), 
      path: pth 
    };
  } catch (e) {
    console.log(`[quote] UniV2 quote failed: ${e.message}`);
    throw e;
  }
}

module.exports = { quoteUniV3, quoteUniV2 };