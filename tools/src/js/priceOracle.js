// src/js/priceOracle.js
// Robust ETH/USD oracle for Base: Chainlink (if provided) -> UniV3 WETH/USDC (fees list) -> FALLBACK_ETH_USD
const { ethers } = require('ethers');

const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || 8453);
const RPC_URL  = process.env.EVM_RPC_URL;

const WETH = (process.env.WETH_ADDRESS || '0x4200000000000000000000000000000000000006').toLowerCase();
const USDC = (process.env.USDC_ADDRESS || '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913').toLowerCase();

const UNI_V3_FACTORY = (process.env.UNI_V3_FACTORY || '0x33128a8fC17869897dcE68Ed026d694621f6FDfD');
const CHAINLINK_FEED = (process.env.CHAINLINK_ETH_USD_FEED || '').toLowerCase();

const V3_FEES = (process.env.UNI_V3_FEE_LIST || '500,3000,10000')
  .split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);

const TTL_SEC = Number(process.env.ORACLE_TTL_SEC || 15);
let _cache = { ts: 0, price: null };

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];
const V3_FACTORY_ABI = [
  'function getPool(address,address,uint24) view returns (address)'
];
const V3_POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96,int24,int24,int24,int24,uint8,bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];
const CHAINLINK_ABI = [
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function decimals() view returns (uint8)'
];

function getProvider() {
  if (!RPC_URL) throw new Error('EVM_RPC_URL missing');
  return new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
}
const nowSec = () => Math.floor(Date.now() / 1000);
const exp10  = (n) => 10n ** BigInt(n);

function toNumberScaled(numer, denom, precision = 12) {
  const scaled = (numer * exp10(precision)) / denom;
  return Number(scaled) / 10 ** precision;
}

async function erc20Meta(addr, pvd) {
  const c = new ethers.Contract(addr, ERC20_ABI, pvd);
  let dec = 18, sym = 'UNK';
  try { dec = Number(await c.decimals()); } catch {}
  try { sym = await c.symbol(); } catch {}
  return { address: ethers.getAddress(addr), decimals: dec, symbol: sym };
}

function priceToken1PerToken0(sqrtPriceX96, dec0, dec1) {
  const Q96 = 2n ** 96n;
  const Q192 = Q96 * Q96;
  const sqrt = BigInt(sqrtPriceX96);
  const num = sqrt * sqrt; // sqrt^2
  const decDiff = BigInt(dec0 - dec1); // <— fixed sign

  let numer = num;
  let denom = Q192;

  if (decDiff > 0n) {
    numer = numer * (10n ** decDiff);
  } else if (decDiff < 0n) {
    denom = denom * (10n ** (-decDiff));
  }

  return toNumberScaled(numer, denom, 12);
}

async function getEthUsdChainlink(pvd) {
  if (!CHAINLINK_FEED) {
    console.log('[oracle] Chainlink feed not configured');
    return null;
  }
  try {
    const feed = new ethers.Contract(CHAINLINK_FEED, CHAINLINK_ABI, pvd);
    const [, answer, , updatedAt] = await feed.latestRoundData();
    const dec = Number(await feed.decimals());
    if (Number(answer) <= 0) throw new Error('Chainlink returned non-positive');
    const price = Number(answer) / 10 ** dec;
    if (price > 100 && price < 10000) {
      console.log('[oracle] Chainlink ETH/USD:', price.toFixed(2), `(updated ${updatedAt})`);
      return price;
    }
    console.log('[oracle] Chainlink price out of sanity range:', price);
    return null;
  } catch (e) {
    console.log('[oracle] Chainlink read failed:', e.shortMessage || e.message || String(e));
    return null;
  }
}

async function getEthUsdUniV3(pvd) {
  console.log('[oracle] Trying Uniswap V3 pools for ETH/USD...');
  const factory = new ethers.Contract(UNI_V3_FACTORY, V3_FACTORY_ABI, pvd);
  const wethMeta = await erc20Meta(WETH, pvd);
  const usdcMeta = await erc20Meta(USDC, pvd);

  for (const fee of V3_FEES) {
    try {
      const poolAddr = await factory.getPool(WETH, USDC, fee);
      if (poolAddr === ethers.ZeroAddress) continue;
      console.log(`[oracle] Found pool for fee ${fee}: ${poolAddr}`);
      const pool = new ethers.Contract(poolAddr, ['function slot0() view returns (uint160)','function token0() view returns (address)','function token1() view returns (address)'], pvd);
      const sqrtPriceX96 = await pool.slot0();
      const t0 = (await pool.token0()).toLowerCase();
      const t1 = (await pool.token1()).toLowerCase();
      let price;
      if (t0 === WETH && t1 === USDC) {
        price = priceToken1PerToken0(sqrtPriceX96, wethMeta.decimals, usdcMeta.decimals);
      } else if (t0 === USDC && t1 === WETH) {
        const wethPerUsdc = priceToken1PerToken0(sqrtPriceX96, usdcMeta.decimals, wethMeta.decimals);
        price = 1 / wethPerUsdc;
      } else {
        continue;
      }
      if (Number.isFinite(price) && price > 100 && price < 10000) {
        console.log(`[oracle] Uniswap V3 ETH/USD (fee ${fee}): $${price.toFixed(2)}`);
        return price;
      }
      console.log(`[oracle] Price out of range for fee ${fee}: ${price}`);
    } catch (e) {
      console.log(`[oracle] UniV3 read failed (fee ${fee}):`, e.shortMessage || e.message || String(e));
    }
  }
  console.log('[oracle] All Uniswap V3 attempts failed');
  return null;
}

async function getEthUsd() {
  const t = nowSec();
  if (_cache.price !== null && (t - _cache.ts) <= TTL_SEC) {
    return _cache.price;
  }
  const pvd = getProvider();
  let price = await getEthUsdChainlink(pvd);
  if (price === null) price = await getEthUsdUniV3(pvd);
  if (price === null) {
    const fb = Number(process.env.FALLBACK_ETH_USD || '0');
    if (fb > 0) {
      console.log('[oracle] Using fallback ETH/USD price:', fb);
      price = fb;
    } else {
      throw new Error('ETH/USD price unavailable (Chainlink+UniV3+fallback failed)');
    }
  }
  _cache = { ts: t, price };
  return price;
}

module.exports = { getEthUsd };
