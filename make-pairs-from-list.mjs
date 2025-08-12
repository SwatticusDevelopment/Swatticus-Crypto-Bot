// make-pairs-from-list.mjs
// Node 18+
// Reads tokens.base.custom.json and writes pairs.base.custom.json
import fs from 'node:fs/promises';

const WETH  = (process.env.WETH_ADDRESS  || '0x4200000000000000000000000000000000000006').toLowerCase();
const USDC  = (process.env.USDC_ADDRESS  || '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913').toLowerCase();
const USDbC = (process.env.USDBC_ADDRESS || '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca').toLowerCase();
// Optional: set this in your env if you want USDT as an anchor on Base
const USDT  = process.env.USDT_ADDRESS ? process.env.USDT_ADDRESS.toLowerCase() : null;

const anchors = [WETH, USDC, USDbC, ...(USDT ? [USDT] : [])];

function uniq(arr) { return [...new Set(arr)]; }

const raw = JSON.parse(await fs.readFile('tokens.base.custom.json', 'utf8'));
const tokenAddrs = raw
  .map(x => (typeof x === 'string' ? x : x?.address))
  .filter(Boolean)
  .map(a => a.toLowerCase())
  .filter(a => !anchors.includes(a)); // don’t duplicate anchors as “targets”

const pairs = [];
const push = (a, b) => {
  if (!a || !b) return;
  const s = `${a}/${b}`;
  if (pairs[pairs.length - 1] !== s) pairs.push(s);
};

for (const t of tokenAddrs) {
  for (const a of anchors) {
    push(a, t);
    push(t, a);
  }
}

const out = uniq(pairs);
await fs.writeFile('pairs.base.custom.json', JSON.stringify(out, null, 2), 'utf8');
console.log(`Wrote pairs.base.custom.json with ${out.length} pairs for ${tokenAddrs.length} tokens.`);
