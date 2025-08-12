
import { Contract, parseUnits, formatUnits } from "ethers";

const FEE_DENOM = 1_000_000n;
const Q96 = 1n << 96n;
const Q192 = Q96 * Q96;

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
];

/**
 * BigInt math — token0 -> token1 using constant sqrtPrice
 * @param {bigint} amount0Raw
 * @param {bigint} sqrtPriceX96
 * @returns {bigint}
 */
export function quote0to1_raw(amount0Raw, sqrtPriceX96) {
  const px = sqrtPriceX96 * sqrtPriceX96; // Q192
  return (amount0Raw * px) / Q192;
}

/**
 * BigInt math — token1 -> token0 using constant sqrtPrice
 * @param {bigint} amount1Raw
 * @param {bigint} sqrtPriceX96
 * @returns {bigint}
 */
export function quote1to0_raw(amount1Raw, sqrtPriceX96) {
  const px = sqrtPriceX96 * sqrtPriceX96; // Q192
  return (amount1Raw * Q192) / px;
}

function applyFeeRaw(amountInRaw, fee) {
  return (amountInRaw * (FEE_DENOM - BigInt(fee))) / FEE_DENOM;
}

/**
 * Slot0 quoter with pure BigInt math.
 * For large sizes, set steps > 1 to chunk input evenly.
 */
export class UniV3Slot0Quoter {
  /**
   * @param {import('ethers').Provider} provider
   */
  constructor(provider) {
    this.provider = provider;
  }

  /**
   * Quote using a known pool address.
   * @param {object} p
   * @param {string} p.poolAddress
   * @param {string} p.tokenIn
   * @param {string} p.tokenOut
   * @param {string} p.amountInHuman - decimal string
   * @param {number} p.fee - 500 / 3000 / 10000
   * @param {number} p.tokenInDecimals
   * @param {number} p.tokenOutDecimals
   * @param {number} [p.steps=1] - chunk steps for large sizes
   */
  async quoteByPoolSlot0(p) {
    const {
      poolAddress,
      tokenIn,
      tokenOut,
      amountInHuman,
      fee,
      tokenInDecimals,
      tokenOutDecimals,
      steps = 1,
    } = p;

    const pool = new Contract(poolAddress, POOL_ABI, this.provider);
    const [t0, t1, slot0] = await Promise.all([
      pool.token0(),
      pool.token1(),
      pool.slot0(),
    ]);

    const token0 = t0.toLowerCase();
    const token1 = t1.toLowerCase();
    const inL = tokenIn.toLowerCase();
    const outL = tokenOut.toLowerCase();

    if (!((inL === token0 && outL === token1) || (inL === token1 && outL === token0))) {
      throw new Error("quoteByPoolSlot0: tokenIn/tokenOut do not match pool token0/token1");
    }

    const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96.toString());
    const amountInRawTotal = parseUnits(amountInHuman, tokenInDecimals);

    const chunks = BigInt(steps);
    const chunkSize = amountInRawTotal / chunks;
    let rem = amountInRawTotal % chunks;

    let outRaw = 0n;
    for (let i = 0n; i < chunks; i++) {
      let thisIn = chunkSize + (rem > 0n ? 1n : 0n);
      if (rem > 0n) rem -= 1n;
      thisIn = applyFeeRaw(thisIn, fee);

      if (inL === token0) {
        outRaw += quote0to1_raw(thisIn, sqrtPriceX96);
      } else {
        outRaw += quote1to0_raw(thisIn, sqrtPriceX96);
      }
    }

    return {
      amountOutRaw: outRaw,
      amountOutHuman: formatUnits(outRaw, tokenOutDecimals),
      sqrtPriceX96: sqrtPriceX96.toString(),
      token0,
      token1,
    };
  }
}
