// src/js/robustQuoter.js - Robust quoting with fallbacks and proper error handling
const { ethers } = require('ethers');
const { getProvider } = require('./robustProvider');
const { findBestPool } = require('./poolChecker');
const { quoteBaseSwap } = require('./baseSwapRouters');

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

// Token metadata cache
const tokenCache = new Map();

async function getTokenMeta(address) {
  const addr = address.toLowerCase();
  if (tokenCache.has(addr)) {
    return tokenCache.get(addr);
  }
  
  // Known tokens on Base
  const knownTokens = {
    '0x4200000000000000000000000000000000000006': { decimals: 18, symbol: 'WETH' },
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { decimals: 6, symbol: 'USDC' },
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { decimals: 6, symbol: 'USDbC' },
    '0xeb466342c4d449bc9f53a865d5cb90586f405215': { decimals: 6, symbol: 'USDT' }
  };
  
  if (knownTokens[addr]) {
    tokenCache.set(addr, knownTokens[addr]);
    return knownTokens[addr];
  }
  
  try {
    const provider = getProvider();
    const contract = new ethers.Contract(address, ERC20_ABI, provider);
    
    const [decimals, symbol] = await Promise.all([
      contract.decimals().catch(() => 18),
      contract.symbol().catch(() => 'UNKNOWN')
    ]);
    
    const meta = { decimals: Number(decimals), symbol };
    tokenCache.set(addr, meta);
    return meta;
    
  } catch (error) {
    console.log(`[tokenMeta] Error getting metadata for ${address}: ${error.message}`);
    const fallback = { decimals: 18, symbol: 'UNKNOWN' };
    tokenCache.set(addr, fallback);
    return fallback;
  }
}

// UniswapV3 slot0-based quote calculation
function calculateV3Quote(sqrtPriceX96, liquidity, amountIn, token0Decimals, token1Decimals, fee, isToken0In) {
  try {
    const Q96 = 2n ** 96n;
    const sqrtPrice = BigInt(sqrtPriceX96);
    
    // Calculate price: (sqrtPrice / 2^96)^2
    const price = (sqrtPrice * sqrtPrice) / (Q96 * Q96);
    
    // Apply decimals adjustment
    const decimalDiff = BigInt(token0Decimals - token1Decimals);
    const adjustedPrice = decimalDiff >= 0n 
      ? price * (10n ** decimalDiff)
      : price / (10n ** (-decimalDiff));
    
    // Apply fee (fee is in hundredths of basis points)
    const feeMultiplier = BigInt(1000000 - fee) / 1000000n;
    const amountAfterFee = (BigInt(amountIn) * feeMultiplier) / 1000000n;
    
    let amountOut;
    if (isToken0In) {
      // token0 -> token1
      amountOut = (amountAfterFee * adjustedPrice) / (10n ** BigInt(token0Decimals));
    } else {
      // token1 -> token0  
      amountOut = (amountAfterFee * (10n ** BigInt(token0Decimals))) / adjustedPrice;
    }
    
    return amountOut > 0n ? amountOut.toString() : null;
    
  } catch (error) {
    console.log(`[v3Quote] Calculation error: ${error.message}`);
    return null;
  }
}

async function quoteUniV3(tokenIn, tokenOut, amountIn) {
  console.log(`[quote] Attempting UniV3 quote: ${tokenIn} -> ${tokenOut}`);
  
  try {
    const [tokenInMeta, tokenOutMeta] = await Promise.all([
      getTokenMeta(tokenIn),
      getTokenMeta(tokenOut)
    ]);
    
    const poolInfo = await findBestPool(tokenIn, tokenOut);
    if (!poolInfo) {
      console.log(`[quote] No UniV3 pool found for ${tokenInMeta.symbol}/${tokenOutMeta.symbol}`);
      return null;
    }
    
    console.log(`[quote] Found UniV3 pool (fee ${poolInfo.fee}): ${poolInfo.address}`);
    
    // Determine token order in pool
    const provider = getProvider();
    const poolContract = new ethers.Contract(poolInfo.address, [
      'function token0() view returns (address)',
      'function token1() view returns (address)'
    ], provider);
    
    const [token0, token1] = await Promise.all([
      poolContract.token0(),
      poolContract.token1()
    ]);
    
    const isToken0In = tokenIn.toLowerCase() === token0.toLowerCase();
    const [token0Meta, token1Meta] = isToken0In 
      ? [tokenInMeta, tokenOutMeta] 
      : [tokenOutMeta, tokenInMeta];
    
    const amountOut = calculateV3Quote(
      poolInfo.sqrtPriceX96,
      poolInfo.liquidity,
      amountIn,
      token0Meta.decimals,
      token1Meta.decimals,
      poolInfo.fee,
      isToken0In
    );
    
    if (!amountOut) {
      console.log(`[quote] V3 calculation failed`);
      return null;
    }
    
    console.log(`[quote] V3 success: ${ethers.formatUnits(amountIn, tokenInMeta.decimals)} ${tokenInMeta.symbol} -> ${ethers.formatUnits(amountOut, tokenOutMeta.decimals)} ${tokenOutMeta.symbol}`);
    
    return {
      router: 'univ3',
      sellToken: tokenIn,
      buyToken: tokenOut,
      sellAmount: amountIn.toString(),
      buyAmount: amountOut,
      fee: poolInfo.fee,
      pool: poolInfo.address
    };
    
  } catch (error) {
    console.log(`[quote] UniV3 error: ${error.message}`);
    return null;
  }
}

async function getAllQuotes(tokenIn, tokenOut, amountIn) {
  const quotes = [];
  
  // Try UniswapV3 first
  try {
    const v3Quote = await quoteUniV3(tokenIn, tokenOut, amountIn);
    if (v3Quote) quotes.push(v3Quote);
  } catch (error) {
    console.log(`[quote] V3 failed: ${error.message}`);
  }
  
  // Try BaseSwap as fallback
  try {
    const baseSwapQuote = await quoteBaseSwap(tokenIn, tokenOut, amountIn);
    if (baseSwapQuote) quotes.push(baseSwapQuote);
  } catch (error) {
    console.log(`[quote] BaseSwap failed: ${error.message}`);
  }
  
  return quotes;
}

async function getBestQuote(tokenIn, tokenOut, amountIn) {
  const quotes = await getAllQuotes(tokenIn, tokenOut, amountIn);
  
  if (quotes.length === 0) {
    console.log(`[quote] No valid quotes found for ${tokenIn}/${tokenOut}`);
    return null;
  }
  
  // Sort by output amount (highest first)
  quotes.sort((a, b) => {
    const aAmount = BigInt(a.buyAmount);
    const bAmount = BigInt(b.buyAmount);
    return aAmount > bAmount ? -1 : aAmount < bAmount ? 1 : 0;
  });
  
  const bestQuote = quotes[0];
  console.log(`[quote] Best quote: ${bestQuote.router} with ${ethers.formatUnits(bestQuote.buyAmount, 6)} output`);
  
  return bestQuote;
}

module.exports = { 
  quoteUniV3, 
  getAllQuotes, 
  getBestQuote, 
  getTokenMeta 
};