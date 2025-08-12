import { Interface, getAddress } from "ethers";

const FACTORY_IFACE = new Interface([
  "function getPool(address,address,uint24) view returns (address)"
]);

const POOL_IFACE = new Interface([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function liquidity() view returns (uint128)"
]);

export async function getPoolAddress(provider, factory, tokenA, tokenB, fee) {
  try {
    const [ta, tb] = [getAddress(tokenA), getAddress(tokenB)];
    const data = FACTORY_IFACE.encodeFunctionData("getPool", [ta, tb, fee]);
    const res = await provider.call({ to: factory, data });
    if (!res || res === "0x") return null;
    const [pool] = FACTORY_IFACE.decodeFunctionResult("getPool", res);
    if (pool === "0x0000000000000000000000000000000000000000") return null;
    return pool;
  } catch {
    return null;
  }
}

export async function readPoolMeta(provider, pool) {
  try {
    const data0 = POOL_IFACE.encodeFunctionData("token0", []);
    const data1 = POOL_IFACE.encodeFunctionData("token1", []);
    const [r0, r1] = await Promise.all([
      provider.call({ to: pool, data: data0 }),
      provider.call({ to: pool, data: data1 }),
    ]);
    if (!r0 || !r1 || r0 === "0x" || r1 === "0x") return null;
    const [t0] = POOL_IFACE.decodeFunctionResult("token0", r0);
    const [t1] = POOL_IFACE.decodeFunctionResult("token1", r1);
    return { token0: t0, token1: t1 };
  } catch {
    return null;
  }
}

export async function readSlot0(provider, pool) {
  try {
    const data = POOL_IFACE.encodeFunctionData("slot0", []);
    const res = await provider.call({ to: pool, data });
    if (!res || res === "0x") return null;
    const [sqrtPriceX96, tick] = POOL_IFACE.decodeFunctionResult("slot0", res);
    // Basic sanity checks
    if (!sqrtPriceX96 || BigInt(sqrtPriceX96.toString()) === 0n) return null;
    if (!Number.isFinite(Number(tick))) return null;
    return { sqrtPriceX96: BigInt(sqrtPriceX96.toString()), tick: Number(tick) };
  } catch {
    return null;
  }
}

export async function readLiquidity(provider, pool) {
  try {
    const data = POOL_IFACE.encodeFunctionData("liquidity", []);
    const res = await provider.call({ to: pool, data });
    if (!res || res === "0x") return null;
    const [liq] = POOL_IFACE.decodeFunctionResult("liquidity", res);
    return BigInt(liq.toString());
  } catch {
    return null;
  }
}
