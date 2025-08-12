
import { Contract, JsonRpcProvider, ZeroAddress } from "ethers";
import { rpcCall, gated } from "../../rpc/provider";
import { UNISWAP_V3_FACTORY_BASE, IUniswapV3FactoryAbi, IUniswapV3PoolAbi } from "./constants";

export function sortTokens(a: string, b: string): [string, string] {
  const A = a.toLowerCase();
  const B = b.toLowerCase();
  return A < B ? [a, b] : [b, a];
}

export async function fetchPoolInitCodeHash(provider: JsonRpcProvider): Promise<string> {
  const factory = new Contract(UNISWAP_V3_FACTORY_BASE, IUniswapV3FactoryAbi, provider);
  return await rpcCall(() => factory.poolInitCodeHash());
}

export async function getPoolAddress(tokenA: string, tokenB: string, fee: number, provider: JsonRpcProvider): Promise<string | null> {
  const [token0, token1] = sortTokens(tokenA, tokenB);
  const factory = new Contract(UNISWAP_V3_FACTORY_BASE, IUniswapV3FactoryAbi, provider);

  const addr: string = await rpcCall(() => gated(provider, async () => {
    return await factory.getPool(token0, token1, fee);
  }), "factory.getPool");

  if (!addr || addr === ZeroAddress) return null;
  return addr;
}

export async function slot0(pool: string, provider: JsonRpcProvider) {
  const c = new Contract(pool, IUniswapV3PoolAbi, provider);
  return await rpcCall(() => gated(provider, async () => {
    return await c.slot0();
  }), "pool.slot0");
}
