// prefilter-existing-pools.mjs
import fs from 'node:fs/promises';
import { JsonRpcProvider, Interface } from 'ethers';
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'; // UniswapV3Factory (Base)
const FEES = [500, 3000, 10000];
const iface = new Interface(['function getPool(address,address,uint24) view returns (address)']);

const provider = new JsonRpcProvider(process.env.RPC_URL, { chainId: 8453, name: 'base' });

const inPairs = JSON.parse(await fs.readFile('pairs.base.custom.json', 'utf8'));
const out = [];

for (const s of inPairs) {
  const [a, b] = s.split('/');
  for (const fee of FEES) {
    try {
      const data = iface.encodeFunctionData('getPool', [a, b, fee]);
      const ret = await provider.call({ to: FACTORY, data });
      const pool = iface.decodeFunctionResult('getPool', ret)[0];
      if (pool && pool !== '0x0000000000000000000000000000000000000000') {
        out.push({ a, b, fee, pool });
        break; // keep first fee tier that exists
      }
    } catch { /* RPC hiccup; skip for now */ }
  }
}

await fs.writeFile('pairs.base.existing.json', JSON.stringify(out, null, 2));
console.log(`kept ${out.length}/${inPairs.length} pairs with at least one v3 pool`);
