import { getPoolAddress, readPoolMeta, readSlot0, readLiquidity } from "./univ3-slot0.mjs";
import { safeDecimals } from "./decimals.mjs";

const Q96 = 2n ** 96n;
const Q192 = Q96 * Q96;
const FEE_DENOM = 1_000_000n; // Uniswap V3 fee denominator

function pow10(n) {
  let x = 1n;
  for (let i = 0; i < n; i++) x *= 10n;
  return x;
}

/**
 * Mid-price quote using slot0 (no tick traversal). Returns null if pool is missing/bad.
 * @param {object} p
 * @param {import("ethers").Provider} p.provider
 * @param {string} p.factory - UniswapV3Factory address
 * @param {string} p.tokenIn
 * @param {string} p.tokenOut
 * @param {number} p.fee - 500/3000/10000
 * @param {bigint} p.amountIn - raw smallest units
 */
export async function quoteMidPrice({ provider, factory, tokenIn, tokenOut, fee, amountIn }) {
  // 1) Find pool
  const pool = await getPoolAddress(provider, factory, tokenIn, tokenOut, fee);
  if (!pool) return null;

  // 2) Guard: liquidity & slot0
  const [slot0, liq, meta] = await Promise.all([
    readSlot0(provider, pool),
    readLiquidity(provider, pool),
    readPoolMeta(provider, pool),
  ]);
  if (!slot0 || !liq || liq === 0n || !meta) return null;

  // 3) Decimals
  const [d0, d1] = await Promise.all([
    safeDecimals(provider, meta.token0, 18),
    safeDecimals(provider, meta.token1, 18)
  ]);

  // 4) Compute price ratio from slot0
  const priceNum = slot0.sqrtPriceX96 * slot0.sqrtPriceX96; // sqrt^2
  const priceDen = Q192;

  // 5) Figure direction (token0 -> token1 or inverse)
  const inIs0 = meta.token0.toLowerCase() === tokenIn.toLowerCase();
  const outIs1 = meta.token1.toLowerCase() === tokenOut.toLowerCase();
  const inIs1 = meta.token1.toLowerCase() === tokenIn.toLowerCase();
  const outIs0 = meta.token0.toLowerCase() === tokenOut.toLowerCase();

  if (!(inIs0 && outIs1) && !(inIs1 && outIs0)) {
    // input/output not matching pool order (shouldn't happen if factory is correct)
    return null;
  }

  // 6) Apply fee
  const feeBN = BigInt(fee);
  const amountInAfterFee = (amountIn * (FEE_DENOM - feeBN)) / FEE_DENOM;

  // 7) Decimal scaling factor
  const tenD0 = pow10(d0);
  const tenD1 = pow10(d1);

  let amountOut;
  if (inIs0 && outIs1) {
    // x1 = x0 * price * 10^d1 / 10^d0
    // price = priceNum / priceDen
    amountOut = (amountInAfterFee * priceNum * tenD1) // numerator
              / (priceDen * tenD0);                   // denominator
  } else {
    // x0 = x1 * price * 10^d0 / 10^d1  -> invert:
    // x_out = x_in * (priceDen / priceNum) * 10^d0 / 10^d1
    amountOut = (amountInAfterFee * priceDen * tenD0)
              / (priceNum * tenD1);
  }

  if (amountOut <= 0n) return null;

  return {
    pool,
    sqrtPriceX96: slot0.sqrtPriceX96,
    liquidity: liq,
    token0: meta.token0,
    token1: meta.token1,
    decimals: { token0: d0, token1: d1 },
    amountOut,
  };
}
