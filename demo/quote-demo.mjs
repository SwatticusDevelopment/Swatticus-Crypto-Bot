import { getProvider } from "../src/provider.mjs";
import { FACTORY_V3, WETH, USDC, FEE } from "../src/constants.mjs";
import { quoteMidPrice } from "../src/quoter-midprice.mjs";

const RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const provider = getProvider(RPC);

async function main() {
  const wei = 2359357685332285n; // ~0.002359 WETH
  const q = await quoteMidPrice({
    provider,
    factory: FACTORY_V3,
    tokenIn: WETH,
    tokenOut: USDC,
    fee: FEE.LOW,
    amountIn: wei,
  });

  if (!q) {
    console.log("No valid midprice (pool missing/uninitialized).");
    return;
  }
  console.log("Pool:", q.pool);
  console.log("sqrtPriceX96:", q.sqrtPriceX96.toString());
  console.log("Liquidity:", q.liquidity.toString());
  console.log("AmountOut:", q.amountOut.toString(), "(raw units)");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
