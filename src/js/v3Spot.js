// src/js/v3Spot.js - UPDATED with better error handling and provider usage
const { ethers } = require('ethers');
const { getProvider } = require('./robustProvider');

const FACTORY_ABI = ['function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)'];
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];
const ERC20_ABI = ['function decimals() view returns (uint8)'];

const UNI_V3_FACTORY = process.env.UNI_V3_FACTORY || '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

// Known decimal overrides for Base
const DECIMAL_OVERRIDES = {
  '0x4200000000000000000000000000000000000006': 18, // WETH
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,  // USDC
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 6,  // USDbC
  '0xeb466342c4d449bc9f53a865d5cb90586f405215': 6   // USDT
};

// Cache for pool addresses and decimals
const poolCache = new Map();
const decimalCache = new Map();

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
  const cacheKey = `${tokenA.toLowerCase()}:${tokenB.toLowerCase()}:${fee}`;
  if (poolCache.has(cacheKey)) {
    return poolCache.get(cacheKey);
  }
  
  try {
    const provider = getProvider();
    const factory = new ethers.Contract(UNI_V3_FACTORY, FACTORY_ABI, provider);
    
    const pool = await factory.call({
      to: UNI_V3_FACTORY,
      data: factory.interface.encodeFunctionData('getPool', [
        ethers.getAddress(tokenA),
        ethers.getAddress(tokenB), 
        fee
      ])
    });
    
    const [poolAddress] = factory.interface.decodeFunctionResult('getPool', pool);
    
    if (!poolAddress || poolAddress === ethers.ZeroAddress) {
      poolCache.set(cacheKey, null);
      return null;
    }
    
    poolCache.set(cacheKey, poolAddress);
    return poolAddress;
    
  } catch (error) {
    console.log(`[v3spot] Factory call failed for ${tokenA}/${tokenB} fee ${fee}: ${error.message}`);
    return null;
  }
}

async function getDecimals(addr) {
  const address = addr.toLowerCase();
  
  if (decimalCache.has(address)) {
    return decimalCache.get(address);
  }
  
  if (DECIMAL_OVERRIDES[address]) {
    decimalCache.set(address, DECIMAL_OVERRIDES[address]);
    return DECIMAL_OVERRIDES[address];
  }
  
  try {
    const provider = getProvider();
    const result = await provider.call({
      to: addr,
      data: '0x313ce567' // decimals() selector
    });
    
    if (!result || result === '0x') {
      decimalCache.set(address, 18);
      return 18;
    }
    
    const decimals = parseInt(result, 16);
    if (!Number.isFinite(decimals) || decimals < 0 || decimals > 77) {
      decimalCache.set(address, 18);
      return 18;
    }
    
    decimalCache.set(address, decimals);
    return decimals;
    
  } catch (error) {
    console.log(`[v3spot] Failed to get decimals for ${addr}: ${error.message}`);
    decimalCache.set(address, 18);
    return 18;
  }
}

async function spotAmountOut(tokenIn, tokenOut, fee, amountInRaw) {
  try {
    const poolAddr = await getPoolAddr(tokenIn, tokenOut, fee);
    if (!poolAddr) {
      throw new Error(`No pool found for ${tokenIn}/${tokenOut} fee=${fee}`);
    }
    
    const provider = getProvider();
    
    // Get pool data
    const [slot0Result, token0Result, token1Result] = await Promise.all([
      provider.call({
        to: poolAddr,
        data: '0x3850c7bd' // slot0() selector
      }),
      provider.call({
        to: poolAddr,
        data: '0x0dfe1681' // token0() selector  
      }),
      provider.call({
        to: poolAddr,
        data: '0xd21220a7' // token1() selector
      })
    ]);
    
    if (!slot0Result || slot0Result === '0x' || !token0Result || !token1Result) {
      throw new Error('Failed to read pool data');
    }
    
    // Decode results
    const slot0Data = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint160', 'int24', 'uint16', 'uint16', 'uint16', 'uint8', 'bool'],
      slot0Result
    );
    
    const token0 = ethers.getAddress('0x' + token0Result.slice(26));
    const token1 = ethers.getAddress('0x' + token1Result.slice(26));
    
    const sqrtPriceX96 = BigInt(slot0Data[0].toString());
    
    if (sqrtPriceX96 === 0n) {
      throw new Error('Pool not initialized');
    }
    
    // Get decimals
    const [dec0, dec1] = await Promise.all([
      getDecimals(token0),
      getDecimals(token1)
    ]);
    
    // Determine direction
    const tokenInAddr = ethers.getAddress(tokenIn);
    const tokenOutAddr = ethers.getAddress(tokenOut);
    
    const isToken0In = tokenInAddr.toLowerCase() === token0.toLowerCase();
    const isToken1Out = tokenOutAddr.toLowerCase() === token1.toLowerCase();
    
    if (!(isToken0In && isToken1Out) && !(tokenInAddr.toLowerCase() === token1.toLowerCase() && tokenOutAddr.toLowerCase() === token0.toLowerCase())) {
      throw new Error('Token addresses do not match pool');
    }
    
    // Calculate price using slot0
    const Q96 = 2n ** 96n;
    const sqrtPrice = sqrtPriceX96;
    const price = (sqrtPrice * sqrtPrice) / (Q96 * Q96);
    
    // Apply decimal adjustment
    const decimalDiff = BigInt(dec0 - dec1);
    let adjustedPrice;
    
    if (decimalDiff > 0n) {
      adjustedPrice = price * (10n ** decimalDiff);
    } else if (decimalDiff < 0n) {
      adjustedPrice = price / (10n ** (-decimalDiff));
    } else {
      adjustedPrice = price;
    }
    
    // Apply fee (fee is in units where 1e6 = 100%)
    const amountIn = BigInt(amountInRaw);
    const feeAmount = (amountIn * BigInt(fee)) / 1000000n;
    const amountAfterFee = amountIn - feeAmount;
    
    let amountOut;
    
    if (isToken0In && isToken1Out) {
      // token0 -> token1
      amountOut = (amountAfterFee * adjustedPrice) / (Q96 * Q96);
    } else {
      // token1 -> token0
      amountOut = (amountAfterFee * Q96 * Q96) / adjustedPrice;
    }
    
    if (amountOut <= 0n) {
      throw new Error('Calculated output is zero or negative');
    }
    
    return amountOut.toString();
    
  } catch (error) {
    console.log(`[v3spot] Error in spotAmountOut: ${error.message}`);
    throw error;
  }
}

module.exports = { spotAmountOut };