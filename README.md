# Slot0 Quoter Hardening Pack (v2)

Drop-in utilities to stabilize Uniswap V3 quoting on **Base (chainId 8453)** when:
- the RPC wobbles (`JsonRpcProvider failed to detect network`),
- pools are missing / uninitialized (`No pool found`, `missing revert data`),
- token `decimals()` reverts.

**What’s inside**
- `src/provider.mjs` — network-pinned provider for Base.
- `src/constants.mjs` — common addresses (WETH, USDC, UniV3 factory) for Base.
- `src/decimals.mjs` — safe `decimals()` with overrides + fallback.
- `src/univ3-slot0.mjs` — guarded pool discovery + `slot0()` read.
- `src/quoter-midprice.mjs` — fee-aware mid‑price quoter (slot0 math), skips bad pools.
- `demo/quote-demo.mjs` — small runnable demo.
- `package.json` — optional, only for running the demo here (ESM, ethers v6).

## Quick start (as a separate demo)
```bash
cd slot0-patch-pack-v2
npm i
node demo/quote-demo.mjs
```

## Porting into your project
1. Copy everything from `src/` into your project (or keep it as a subfolder and import).
2. Use the provider:
   ```js
   import { getProvider } from "./src/provider.mjs";
   const provider = getProvider(process.env.BASE_RPC || "https://mainnet.base.org");
   ```
3. Wire the quoter where your engine does its **slot0 Quoter bypass**:
   ```js
   import { quoteMidPrice } from "./src/quoter-midprice.mjs";
   import { WETH, USDC, FEE } from "./src/constants.mjs";

   const amountInWei = 2359357685332285n; // example
   const out = await quoteMidPrice({ provider, tokenIn: WETH, tokenOut: USDC, fee: FEE.LOW, amountIn: amountInWei });
   if (out) {
     console.log("midprice amountOut:", out.amountOut.toString());
   } else {
     console.log("no valid midprice (pool missing/uninitialized)");
   }
   ```
4. Keep your existing quoter(s) and routers — just use this as a *first pass* or *fallback* so bad pools don’t blow up the fanout.

## Notes
- All files are **ESM** (`.mjs`) to be friendly with ethers v6. If your app is CommonJS, use dynamic import:
  ```js
  const { quoteMidPrice } = await import("./src/quoter-midprice.mjs");
  ```
- This mid‑price model is a **single‑slot approximation** (no ticks/liquidity stepping). It’s great for sanity checks and small probes. For execution prices on size, stick to on-chain quoter or your router simulation.

## Tested on
- Node 18+
- ethers 6.15.x
- Base chain (8453)
