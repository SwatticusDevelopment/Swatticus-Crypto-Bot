import 'dotenv/config';
import { formatUnits, parseUnits } from 'ethers';
import { provider } from './provider.js';
import { limiter } from './limit.js';
import { getQuoteForPair } from './routers/univ3.js';
import { safeAddress, sleep } from './utils/misc.js';

const network = await provider.getNetwork().catch(() => ({ chainId: 8453n, name: 'base' }));
console.log('[init] network', network);

const DEFAULT_PAIRS = [
  // WETH -> USDC
  '0x4200000000000000000000000000000000000006>0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  // WETH -> cbETH
  '0x4200000000000000000000000000000000000006>0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'
];

const pairsEnv = (process.env.PAIRS || '').split(',').map(s => s.trim()).filter(Boolean);
const pairs = (pairsEnv.length ? pairsEnv : DEFAULT_PAIRS)
  .map(s => {
    const [a,b] = s.split('>');
    return { tokenIn: safeAddress(a), tokenOut: safeAddress(b) };
  });

const FEE_TIERS = (process.env.FEE_TIERS || '500,3000,10000')
  .split(',').map(s => Number(s.trim())).filter(n => [500,3000,10000].includes(n));

const QUOTE_AMOUNT_IN = process.env.QUOTE_AMOUNT_IN || '0.0025';

async function tickOnce() {
  for (const { tokenIn, tokenOut } of pairs) {
    for (const fee of FEE_TIERS) {
      try {
        const q = await getQuoteForPair({ tokenIn, tokenOut, fee, humanAmountIn: QUOTE_AMOUNT_IN });
        if (!q) {
          console.log('[skip]', { pair: `${tokenIn}/${tokenOut}`, fee, msg: 'no pool or no liquidity' });
          continue;
        }
        const { amountIn, amountOut, symbolIn, symbolOut, decIn, decOut, pool, price } = q;
        console.log('[quote]', {
          pair: `${symbolIn}/${symbolOut}`,
          fee,
          pool,
          amountIn: `${formatUnits(amountIn, decIn)} ${symbolIn}`,
          amountOut: `${formatUnits(amountOut, decOut)} ${symbolOut}`,
          px: price
        });
      } catch (e) {
        console.log('[warn]', { pair: `${tokenIn}/${tokenOut}`, fee, msg: e?.message || String(e) });
      }
      // light jitter to avoid burst alignment
      await sleep(150 + Math.random() * 150);
    }
  }
}

async function main() {
  console.log('[run] pairs', pairs, 'fees', FEE_TIERS);
  while (true) {
    await tickOnce();
    await sleep(1000);
  }
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});