
import { ethers } from "ethers";

export type V2PairLike = {
  getReserves(): Promise<[bigint, bigint, number]>; // reserve0, reserve1, blockTimestampLast
  token0(): Promise<string>;
  token1(): Promise<string>;
};

export type RouterLike = {
  getAmountsOut(amountIn: bigint, path: string[]): Promise<bigint[]>;
};

export type Prerequisite = (args: {
  tokenIn: string;
  tokenOut: string;
  router?: RouterLike;
  provider?: ethers.JsonRpcProvider;
}) => Promise<{ ok: boolean; reason?: string }>;
