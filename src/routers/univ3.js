import { Contract, parseUnits } from 'ethers';
import { provider } from '../provider.js';
import { limiter } from '../limit.js';
import { UNISWAP_V3_FACTORY, UNISWAP_V3_POOL, ERC20 } from '../utils/abis.js';
import { ZERO } from '../utils/misc.js';

const UNIV3_FACTORY_BASE = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

const factory = new Contract(UNIV3_FACTORY_BASE, UNISWAP_V3_FACTORY, provider);

const call = async (fn, ...args) => limiter.schedule(() => fn(...args));

async function getPoolAddr(tokenA, tokenB, fee) {
  try {
    const pool = await call(factory.getPool, tokenA, tokenB, fee);
    if (!pool || pool === ZERO) return null;
    return pool;
  } catch {
    return null;
  }
}

async function getTokenMeta(addr) {
  const c = new Contract(addr, ERC20, provider);
  const [dec, sym] = await Promise.all([
    call(c.decimals),
    call(c.symbol).catch(() => 'TKN')
  ]);
  return { dec: Number(dec), sym };
}

// price = 1.0001^tick * 10^(dec0-dec1)
// returns price of token1 per token0
function priceFromTick(tick, dec0, dec1) {
  const base = 1.0001;
  const p = Math.pow(base, Number(tick));
  const scale = Math.pow(10, dec0 - dec1);
  return p * scale;
}

// Given tokenIn -> tokenOut, compute amountOut using tick-derived price.
export async function getQuoteForPair({ tokenIn, tokenOut, fee, humanAmountIn }) {
  const pool = await getPoolAddr(tokenIn, tokenOut, fee);
  if (!pool) return null;

  const poolC = new Contract(pool, UNISWAP_V3_POOL, provider);

  // Guard: check liquidity and slot0
  let slot0, liq;
  try {
    [slot0, liq] = await Promise.all([
      call(poolC.slot0),
      call(poolC.liquidity)
    ]);
  } catch {
    return null;
  }
  if (!slot0 || !liq || liq === 0n) return null;

  const [poolToken0, poolToken1] = await Promise.all([call(poolC.token0), call(poolC.token1)]);

  const [metaIn, metaOut] = await Promise.all([getTokenMeta(tokenIn), getTokenMeta(tokenOut)]);
  const amountIn = parseUnits(String(humanAmountIn), metaIn.dec);

  // compute price (token1 per token0)
  const px10 = priceFromTick(slot0.tick, await decimalsOf(poolToken0), await decimalsOf(poolToken1));

  // figure direction
  let amountOut;
  let price;
  if (tokenIn.toLowerCase() === poolToken0.toLowerCase()) {
    // token0 -> token1
    price = px10; // token1 per token0
    const outFloat = Number(amountIn) / Math.pow(10, metaIn.dec) * price;
    amountOut = BigInt(Math.floor(outFloat * Math.pow(10, metaOut.dec)));
  } else {
    // token1 -> token0
    price = 1 / px10; // token0 per token1
    const outFloat = Number(amountIn) / Math.pow(10, metaIn.dec) * price;
    amountOut = BigInt(Math.floor(outFloat * Math.pow(10, metaOut.dec)));
  }

  return {
    pool,
    amountIn,
    amountOut,
    symbolIn: metaIn.sym,
    symbolOut: metaOut.sym,
    decIn: metaIn.dec,
    decOut: metaOut.dec,
    price
  };
}

const _decCache = new Map();
async function decimalsOf(addr) {
  const key = addr.toLowerCase();
  if (_decCache.has(key)) return _decCache.get(key);
  const c = new Contract(addr, ERC20, provider);
  const d = Number(await call(c.decimals));
  _decCache.set(key, d);
  return d;
}