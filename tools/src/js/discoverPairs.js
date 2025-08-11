// src/js/discoverPairs.js
// Robust BaseSwap (UniV2) pair discovery with:
// 1) Primary: factory index (allPairsLength/allPairs)
// 2) Fallback: PairCreated logs, auto-chunked to ≤ provider limits
const { ethers } = require('ethers');

const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || 8453);
const RPC_URL   = process.env.EVM_RPC_URL;
const FACTORY   = (process.env.BASESWAP_FACTORY || '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB').toLowerCase();
const WETH      = (process.env.WETH_ADDRESS || '0x4200000000000000000000000000000000000006').toLowerCase();
const USDC      = (process.env.USDC_ADDRESS || '0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913').toLowerCase();

const V2_FACTORY_ABI = [
  'function allPairsLength() view returns (uint256)',
  'function allPairs(uint256) view returns (address pair)',
];
const V2_PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

// ————— util —————
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const withTimeout = (p, ms, tag='op') => Promise.race([
  p, new Promise((_,rej)=>setTimeout(()=>rej(new Error(`${tag} timeout after ${ms}ms`)), ms))
]);
const norm = (s)=>String(s||'').trim().toLowerCase();
const pairStr = (a,b)=>`${norm(a)}/${norm(b)}`;

function parseList(s){ return String(s||'').split(',').map(x=>x.trim()).filter(Boolean); }
function dedup(arr){ return Array.from(new Set(arr.map(String))); }

function applyExclusionsAddrPairs(addrPairs, exclude){
  const ex = parseList(exclude||'')
    .concat([`${WETH}/${USDC}`, `${USDC}/${WETH}`])
    .map(x=>x.toLowerCase());

  if (!ex.length) return addrPairs;
  const exSet = new Set(ex.flatMap(p => [p, p.split('/').reverse().join('/')]));
  return addrPairs.filter(p => !exSet.has(p.toLowerCase()));
}

async function enumerateViaFactory(provider, factoryAddr, { concurrency=16, logEvery=1000 } = {}){
  const factory = new ethers.Contract(factoryAddr, V2_FACTORY_ABI, provider);
  const total = Number(await withTimeout(factory.allPairsLength(), 15000, 'allPairsLength'));
  console.log(`[pairs] factory index length = ${total}`);
  if (!Number.isFinite(total) || total <= 0) return [];

  const out = new Array(total);
  let i = 0, done = 0, lastLog=0;

  async function fetchOne(idx){
    try{
      const pairAddr = await withTimeout(factory.allPairs(idx), 15000, `allPairs(${idx})`);
      const pair = new ethers.Contract(pairAddr, V2_PAIR_ABI, provider);
      const t0 = await withTimeout(pair.token0(), 15000, `token0(${idx})`);
      const t1 = await withTimeout(pair.token1(), 15000, `token1(${idx})`);
      out[idx] = { pair: pairAddr.toLowerCase(), token0: t0.toLowerCase(), token1: t1.toLowerCase() };
    } catch {
      out[idx] = null;
    } finally {
      done++;
      if (done - lastLog >= logEvery) { lastLog = done; console.log(`[pairs] ${done}/${total}`); }
    }
  }

  const workers = Array.from({length: Math.max(1, concurrency)}, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= total) break;
      await fetchOne(idx);
    }
  });
  await Promise.all(workers);

  const missed = [];
  out.forEach((v, idx)=>{ if (!v) missed.push(idx); });
  if (missed.length){
    console.log(`[pairs] retrying ${missed.length} missed indices...`);
    for (const idx of missed){
      try{
        const pairAddr = await withTimeout(factory.allPairs(idx), 15000, `allPairs(retry ${idx})`);
        const pair = new ethers.Contract(pairAddr, V2_PAIR_ABI, provider);
        const t0 = await withTimeout(pair.token0(), 15000, `token0(retry ${idx})`);
        const t1 = await withTimeout(pair.token1(), 15000, `token1(retry ${idx})`);
        out[idx] = { pair: pairAddr.toLowerCase(), token0: t0.toLowerCase(), token1: t1.toLowerCase() };
      } catch { /* give up */ }
      if ((idx % 500) === 0) await sleep(50);
    }
  }
  return out.filter(Boolean);
}

async function enumerateViaLogs(provider, factoryAddr, { chunk=450, pauseMs=120 } = {}){
  const topic = ethers.id('PairCreated(address,address,address,uint256)');
  const latest = await withTimeout(provider.getBlockNumber(), 10000, 'getBlockNumber');
  let fromBlock = process.env.FACTORY_START_BLOCK ? Number(process.env.FACTORY_START_BLOCK) : 1;
  const out = new Map();

  console.log(`[pairs] logs fallback: range ${fromBlock}..${latest}, chunk=${chunk}`);
  for (let f = fromBlock; f <= latest; f += chunk){
    const t = Math.min(latest, f + chunk - 1);
    try{
      const logs = await withTimeout(provider.getLogs({ address: factoryAddr, fromBlock: f, toBlock: t, topics: [topic] }), 20000, `getLogs(${f}-${t})`);
      for (const lg of logs){
        const token0 = ethers.getAddress('0x'+lg.topics[1].slice(26)).toLowerCase();
        const token1 = ethers.getAddress('0x'+lg.topics[2].slice(26)).toLowerCase();
        const pair   = lg.address.toLowerCase();
        out.set(pair, { pair, token0, token1 });
      }
    } catch (e) {
      console.log(`[pairs] getLogs failed on ${f}-${t}: ${e.message}`);
    }
    await sleep(pauseMs);
  }
  return [...out.values()];
}

async function discoverPairs(options = {}){
  if (!RPC_URL) throw new Error('EVM_RPC_URL missing');
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);

  console.log(`[pairs] provider ok, chainId=${CHAIN_ID}`);
  console.log(`[pairs] factory=${FACTORY}`);

  let pairs = [];
  try {
    pairs = await enumerateViaFactory(provider, FACTORY, {
      concurrency: Number(process.env.V2_ENUM_CONCURRENCY || 12),
      logEvery: 1000
    });
  } catch (e) {
    console.log(`[pairs] factory index failed: ${e.message}`);
  }

  if (!pairs.length){
    console.log('[pairs] switching to logs fallback...');
    pairs = await enumerateViaLogs(provider, FACTORY, {
      chunk: Number(process.env.LOG_CHUNK_BLOCKS || 450),
      pauseMs: Number(process.env.LOG_PAUSE_MS || 120)
    });
  }

  console.log(`[pairs] raw discovered pairs: ${pairs.length}`);
  let addrPairs = [];
  for (const p of pairs){
    addrPairs.push(pairStr(p.token0, p.token1));
    addrPairs.push(pairStr(p.token1, p.token0));
  }

  addrPairs = applyExclusionsAddrPairs(addrPairs, options.exclude || process.env.EVM_PAIR_EXCLUDE);
  addrPairs = dedup(addrPairs);
  console.log(`[pairs] final pairs (after exclude/dedup): ${addrPairs.length}`);
  return addrPairs;
}

module.exports = { discoverPairs };
