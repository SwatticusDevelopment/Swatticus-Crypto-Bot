
import { makeProvider } from "./provider.js";
import { getDecimals } from "./decimals.js";
import { UniV3Slot0Quoter } from "./univ3Slot0.js";
import { NegativePoolCache } from "./missingPools.js";

async function main() {
  const provider = makeProvider([
    process.env.RPC_URL,
    process.env.RPC_URL_2,
  ]);

  const quoter = new UniV3Slot0Quoter(provider);
  const miss = new NegativePoolCache();

  const WETH   = "0x4200000000000000000000000000000000000006";
  const AXLUSDC= "0xEB466342C4d449BC9f53A865D5Cb90586f405215";

  // example WETH/axlUSDC 0.05% pool (from your logs)
  const POOL = "0x53Ba76436138c4344613294D06195908A33DCCA1";
  const FEE = 500;

  const pairKey = NegativePoolCache.key(WETH, AXLUSDC, FEE);
  if (miss.has(pairKey)) {
    console.log("Skipping known-missing pool", pairKey);
    return;
  }

  const dIn  = await getDecimals(WETH, provider);
  const dOut = await getDecimals(AXLUSDC, provider);

  const amountIn = "0.002334943103123282";
  const res = await quoter.quoteByPoolSlot0({
    poolAddress: POOL,
    tokenIn: WETH,
    tokenOut: AXLUSDC,
    amountInHuman: amountIn,
    fee: FEE,
    tokenInDecimals: dIn,
    tokenOutDecimals: dOut,
    steps: 1,
  });

  console.log("OUT:", res.amountOutHuman, "raw:", res.amountOutRaw.toString());
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
