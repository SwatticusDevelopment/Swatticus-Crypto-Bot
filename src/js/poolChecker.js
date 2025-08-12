// src/js/poolChecker.js - Check if pools exist before attempting quotes
const { ethers } = require('ethers');
const { getProvider } = require('./robustProvider');

const FACTORY_ABI = ['function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address)'];
const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)'
];

const UNI_V3_FACTORY = process.env.UNI_V3_FACTORY || '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

// Cache to avoid repeated checks
const poolCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(tokenA, tokenB, fee) {
  const [a, b] = [tokenA.toLowerCase(), tokenB.toLowerCase()].sort();
  return `${a}:${b}:${fee}`;
}

async function checkPoolExists(tokenA, tokenB, fee) {
  const cacheKey = getCacheKey(tokenA, tokenB, fee);
  const cached = poolCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.result;
  }
  
  try {
    const provider = getProvider();
    const factory = new ethers.Contract(UNI_V3_FACTORY, FACTORY_ABI, provider);
    
    const poolAddress = await factory.getPool(
      ethers.getAddress(tokenA),
      ethers.getAddress(tokenB),
      fee
    );
    
    if (!poolAddress || poolAddress === ethers.ZeroAddress) {
      const result = { exists: false, reason: 'no_pool' };
      poolCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }
    
    // Check if pool has liquidity
    const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
    
    try {
      const [slot0, liquidity] = await Promise.all([
        pool.slot0(),
        pool.liquidity()
      ]);
      
      if (!slot0 || !slot0[0] || slot0[0] === 0n) {
        const result = { exists: false, reason: 'uninitialized' };
        poolCache.set(cacheKey, { result, timestamp: Date.now() });
        return result;
      }
      
      if (!liquidity || liquidity === 0n) {
        const result = { exists: false, reason: 'no_liquidity' };
        poolCache.set(cacheKey, { result, timestamp: Date.now() });
        return result;
      }
      
      const result = { 
        exists: true, 
        address: poolAddress, 
        sqrtPriceX96: slot0[0], 
        liquidity 
      };
      poolCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
      
    } catch (poolError) {
      console.log(`[poolChecker] Pool data error: ${poolError.message}`);
      const result = { exists: false, reason: 'read_error' };
      poolCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }
    
  } catch (error) {
    console.log(`[poolChecker] Factory error: ${error.message}`);
    // Don't cache errors, might be transient
    return { exists: false, reason: 'factory_error' };
  }
}

async function findBestPool(tokenA, tokenB, feeTiers = [500, 3000, 10000]) {
  for (const fee of feeTiers) {
    const poolInfo = await checkPoolExists(tokenA, tokenB, fee);
    if (poolInfo.exists) {
      return { ...poolInfo, fee };
    }
  }
  return null;
}

module.exports = { checkPoolExists, findBestPool };