// src/js/v3Spot.js - FINAL FIXED VERSION with correct decimal adjustment
const { ethers } = require('ethers');
const cfg = require('./multichainConfig');

const FACTORY_ABI = ['function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)'];
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];
const ERC20_ABI = ['function decimals() view returns (uint8)'];

function provider(){ return new ethers.JsonRpcProvider(cfg.EVM_RPC_URL, cfg.EVM_CHAIN_ID); }

const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
const matchesWethUsdc = (a,b) => { 
  const WETH = process.env.WETH_ADDRESS || ''; 
  const USDC = process.env.USDC_ADDRESS || ''; 
  return (same(a,WETH) && same(b,USDC)) || (same(a,USDC) && same(b,WETH)); 
};

const DEFAULT_BASE_POOLS = {
  500: '0xd0b53D9277642d899DF5C87A3966A349A798F224',
  3000: '0x6c561B446416E1A00E8E93E221854d6eA4171372',
  10000: '0x0b1C2DCbBfA744ebD3fC17fF1A96A1E1Eb4B2d69'
};

function safeToNumber(value) {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value.toString());
    }
    return Number(value);
  }
  return Number(value);
}

async function getPoolAddr(tokenA, tokenB, fee) {
  const pv = provider();
  const factory = new ethers.Contract(cfg.UNI_V3_FACTORY, FACTORY_ABI, pv);
  
  let pool = ethers.ZeroAddress;
  
  try {
    pool = await factory.getPool(tokenA, tokenB, fee);
  } catch (e) {
    console.log(`[v3spot] Factory call failed: ${e.message}`);
  }
  
  if (pool === ethers.ZeroAddress && matchesWethUsdc(tokenA, tokenB)) {
    const env = process.env[`UNI_V3_WETH_USDC_POOL_${fee}`];
    if (env && ethers.isAddress(env)) {
      console.log(`[v3spot] Using env pool for fee ${fee}: ${env}`);
      pool = env;
    }
  }
  
  if (pool === ethers.ZeroAddress && Number(cfg.EVM_CHAIN_ID) === 8453 && matchesWethUsdc(tokenA, tokenB)) {
    const hard = DEFAULT_BASE_POOLS[fee];
    if (hard) {
      console.log(`[v3spot] Using hardcoded Base pool for fee ${fee}: ${hard}`);
      pool = hard;
    }
  }
  
  if (!pool || pool === ethers.ZeroAddress) {
    throw new Error(`No pool found for ${tokenA}/${tokenB} fee=${fee}`);
  }
  
  return pool;
}

async function ercDecimals(addr) {
  const erc = new ethers.Contract(addr, ERC20_ABI, provider());
  const decimals = await erc.decimals();
  return safeToNumber(decimals);
}

async function spotAmountOut(tokenIn, tokenOut, fee, amountInRaw) {
  try {
    const pv = provider();
    const poolAddr = await getPoolAddr(tokenIn, tokenOut, fee);
    
    console.log(`[v3spot] Using pool ${poolAddr} for ${tokenIn}/${tokenOut} fee=${fee}`);
    
    const pool = new ethers.Contract(poolAddr, POOL_ABI, pv);
    
    const [slot0, token0, token1] = await Promise.all([
      pool.slot0(),
      pool.token0(),
      pool.token1()
    ]);
    
    const sqrtPriceX96 = slot0[0];
    const tick = safeToNumber(slot0[1]);
    
    const t0 = token0.toLowerCase();
    const t1 = token1.toLowerCase();
    const aIn = ethers.getAddress(tokenIn).toLowerCase();
    const aOut = ethers.getAddress(tokenOut).toLowerCase();
    
    console.log(`[v3spot] Pool tokens: token0=${t0}, token1=${t1}`);
    console.log(`[v3spot] Trade: ${aIn} -> ${aOut}`);
    console.log(`[v3spot] Raw tick: ${tick}`);
    
    const [dec0, dec1] = await Promise.all([
      ercDecimals(t0),
      ercDecimals(t1)
    ]);
    
    console.log(`[v3spot] Decimals: token0=${dec0}, token1=${dec1}`);
    
    // Use sqrtPriceX96 directly for maximum precision
    const sqrtPrice = safeToNumber(sqrtPriceX96);
    const Q96 = Math.pow(2, 96);
    
    // sqrtPriceX96 = sqrt(price) * 2^96
    // where price = token1/token0 (amount of token1 per 1 token0)
    const sqrtRatio = sqrtPrice / Q96;
    const rawPrice = sqrtRatio * sqrtRatio;
    
    console.log(`[v3spot] sqrtPriceX96: ${sqrtPrice}`);
    console.log(`[v3spot] Raw price (token1/token0): ${rawPrice}`);
    
    // CRITICAL FIX: Correct decimal adjustment
    // The raw price is already in the right units, but we need to adjust for decimal differences
    // If token0 has 18 decimals and token1 has 6 decimals:
    // 1 unit of token0 (1e18 wei) should give rawPrice units of token1 (in wei, 1e6 scale)
    // So we need to multiply by 10^(dec0 - dec1) = 10^(18-6) = 10^12
    const decimalAdjustedPrice = rawPrice * Math.pow(10, dec0 - dec1);
    
    console.log(`[v3spot] Decimal adjusted price: ${decimalAdjustedPrice}`);
    
    // Determine input/output decimals and calculate the conversion
    const inDec = (aIn === t0 ? dec0 : dec1);
    const outDec = (aOut === t1 ? dec1 : dec0);
    
    const amountInHuman = safeToNumber(amountInRaw) / Math.pow(10, inDec);
    
    // Apply pool fee (fee is in basis points, e.g., 500 = 0.05%)
    const feePct = (fee || 500) / 1e6;
    const amountAfterFee = amountInHuman * (1 - feePct);
    
    console.log(`[v3spot] Amount in: ${amountInHuman}, after fee: ${amountAfterFee}`);
    
    let outHuman;
    
    if (aIn === t0 && aOut === t1) {
      // token0 -> token1, use price as is
      outHuman = amountAfterFee * decimalAdjustedPrice;
      console.log(`[v3spot] token0 -> token1: ${amountAfterFee} * ${decimalAdjustedPrice} = ${outHuman}`);
    } else if (aIn === t1 && aOut === t0) {
      // token1 -> token0, invert the price
      const invertedPrice = 1 / decimalAdjustedPrice;
      outHuman = amountAfterFee * invertedPrice;
      console.log(`[v3spot] token1 -> token0: ${amountAfterFee} * ${invertedPrice} = ${outHuman}`);
    } else {
      throw new Error('Input/output tokens do not match pool tokens');
    }
    
    if (!isFinite(outHuman) || outHuman <= 0) {
      throw new Error(`Output amount calculation resulted in invalid number: ${outHuman}`);
    }
    
    // Convert back to wei/raw units
    const outRaw = Math.floor(outHuman * Math.pow(10, outDec));
    
    console.log(`[v3spot] Final amount out: ${outHuman} human, ${outRaw} raw`);
    
    // Sanity check - output should be > 0
    if (outRaw <= 0) {
      throw new Error(`Calculated output amount is zero or negative: ${outRaw}`);
    }
    
    return String(outRaw);
    
  } catch (e) {
    console.log(`[v3spot] Error in spotAmountOut: ${e.message}`);
    throw e;
  }
}

module.exports = { spotAmountOut };