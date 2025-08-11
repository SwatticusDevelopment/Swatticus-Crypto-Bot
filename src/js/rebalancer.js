// src/js/rebalancer.js
// Rebalance all held tokens back to WETH on Base
// Adds wallet-wide discovery using on-chain log scan (no CSV dependency).
//
// Exports:
//   startRebalancer()
//   rebalanceOnce()
//   addWatchTokens(addresses)
//   seedFromCsvRange(days)
//   seedFromWalletLogs(opts)   <-- NEW
//
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { getEthUsd } = require('./priceOracle');
const { discoverWalletTokens } = require('./walletScan');
let tradesCsv, wsBus, baseSwapRouters;
try { tradesCsv = require('./tradesCsv'); } catch {}
try { wsBus     = require('./wsBus'); } catch {}
try { baseSwapRouters = require('./baseSwapRouters'); } catch {}

const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || 8453);
const RPC_URL  = process.env.EVM_RPC_URL;
if (!RPC_URL) console.warn('[rebalance] WARN: EVM_RPC_URL missing');

const WETH  = (process.env.WETH_ADDRESS  || '0x4200000000000000000000000000000000000006').toLowerCase();
const USDC  = (process.env.USDC_ADDRESS  || '0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913').toLowerCase();
const USDBC = (process.env.USDBC_ADDRESS || '0xeb466342c4d449bc9f53a865d5cb90586f405215').toLowerCase();
const DEFAULT_ROUTER = (process.env.BASESWAP_ROUTER || '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86');

const INCLUDE_STABLES = /^true$/i.test(process.env.REBALANCE_INCLUDE_STABLES || 'false');
const MIN_USD = Number(process.env.REBALANCE_MIN_USD || '2');
const EVERY_SEC = Number(process.env.REBALANCE_EVERY_SEC || '600');
const WALLET_SCAN_STEP = Number(process.env.WALLET_SCAN_STEP || '500');

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)'
];
const V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)'
];

function norm(a){ return (a||'').toLowerCase(); }
function addr(a){ return ethers.getAddress(a); }
function getProvider(){ return new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID); }
function getSigner(){ return new ethers.Wallet(process.env.EVM_PRIVATE_KEY, getProvider()); }
function parseList(s){ return String(s||'').split(',').map(x=>x.trim()).filter(Boolean).map(norm); }

const excludeSet = new Set(parseList(process.env.REBALANCE_EXCLUDE));
excludeSet.add(norm(WETH)); // never sell WETH
if (!INCLUDE_STABLES){ excludeSet.add(norm(USDC)); excludeSet.add(norm(USDBC)); }

// -- watch list of candidate tokens to flush back to WETH
const watch = new Set();
function addWatchTokens(addresses){
  for (const a of (addresses||[])){
    const x = norm(a);
    if (!x) continue;
    if (!excludeSet.has(x)) watch.add(x);
  }
}

// ===== Wallet-wide seed via on-chain logs =====
async function seedFromWalletLogs({ fromBlock, toBlock } = {}){
  const provider = getProvider();
  const signer = getSigner();
  const owner = await signer.getAddress();
 const latest = BigInt(await provider.getBlockNumber());
const from = (fromBlock != null) ? BigInt(fromBlock) : 0n;
let to   = (toBlock != null && BigInt(toBlock) > 0n) ? BigInt(toBlock) : latest;
if (to < from) to = latest; // safety
 console.log(`[rebalance] scanning wallet logs ${owner} blocks [${from}..${to}] step=${WALLET_SCAN_STEP}`);
  const set = await discoverWalletTokens(provider, owner, from, to, WALLET_SCAN_STEP);
  const arr = Array.from(set);
  let added = 0;
  for (const t of arr){
    const x = norm(t);
    if (!excludeSet.has(x)) { watch.add(x); added++; }
  }
  console.log(`[rebalance] wallet scan discovered ${arr.length} tokens (${added} added to watch)`);
  return arr;
}

// ===== CSV seeding (still available) =====
function tradesDir(){
  const d = process.env.TRADES_DIR || process.cwd();
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

function seedFromCsvRange(days=1){
  const dir = tradesDir();
  const now = new Date();
  const files = [];
  for (let i=0;i<days;i++){
    const dt = new Date(now.getTime() - i*24*3600*1000);
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,'0');
    const d = String(dt.getDate()).padStart(2,'0');
    files.push(path.join(dir, `trades-${y}-${m}-${d}.csv`));
  }
  for (const fp of files){
    try {
      if (!fs.existsSync(fp)) continue;
      const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
      for (let i=1;i<lines.length;i++){
        const cols = lines[i].split(',');
        const buyToken = norm(cols[5]||'');
        const sellToken = norm(cols[3]||'');
        if (buyToken && !excludeSet.has(buyToken)) watch.add(buyToken);
        if (sellToken && !excludeSet.has(sellToken)) watch.add(sellToken);
      }
    } catch {}
  }
}

// ===== Helpers for pricing & execution =====
async function tokenMeta(pvd, a){
  const c = new ethers.Contract(a, ERC20_ABI, pvd);
  let dec=18, sym='TKN';
  try { dec = Number(await c.decimals()); } catch {}
  try { sym = await c.symbol(); } catch {}
  return { decimals: dec, symbol: sym, contract: c };
}

async function balanceOf(pvd, token, owner){
  try {
    const c = new ethers.Contract(token, ERC20_ABI, pvd);
    const v = await c.balanceOf(owner);
    return BigInt(v);
  } catch { return 0n; }
}

async function usdOf(token, raw, dec, ethUsd){
  const t = norm(token);
  if (t === norm(USDC) || t === norm(USDBC)) return Number(raw)/1e6;
  if (t === norm(WETH)) return (Number(raw)/1e18)*ethUsd;
  const router = new ethers.Contract(DEFAULT_ROUTER, V2_ROUTER_ABI, getProvider());
  try {
    const amounts = await router.getAmountsOut(raw, [addr(token), addr(USDC)]);
    return Number(amounts[1]) / 1e6;
  } catch {
    try {
      const amounts = await router.getAmountsOut(raw, [addr(token), addr(WETH)]);
      return (Number(amounts[1]) / 1e18) * ethUsd;
    } catch { return 0; }
  }
}

async function bestQuoteToWETH(token, amountRaw){
  const provider = getProvider();
  const router = new ethers.Contract(DEFAULT_ROUTER, V2_ROUTER_ABI, provider);
  const paths = [
    [addr(token), addr(WETH)],
    [addr(token), addr(USDC), addr(WETH)],
    [addr(token), addr(USDBC), addr(WETH)],
  ];
  for (const path of paths){
    try {
      const amts = await router.getAmountsOut(amountRaw, path);
      const out = BigInt(amts[amts.length-1]);
      if (out > 0n){
        return {
          router: 'baseswap',
          sellToken: path[0],
          buyToken:  path[path.length-1],
          sellAmount: amountRaw.toString(),
          buyAmount:  out.toString(),
          path: path.map(ethers.getAddress)
        };
      }
    } catch {}
  }
  throw new Error('No route to WETH');
}

async function rebalanceOnce(){
  const pvd = getProvider();
  const signer = getSigner();
  const owner = await signer.getAddress();
  const ethUsd = await getEthUsd();

  let checked = 0, sold = 0;

  for (const t of Array.from(watch)){
    if (excludeSet.has(norm(t))) continue;
    checked++;

    const meta = await tokenMeta(pvd, t);
    const bal = await balanceOf(pvd, t, owner);
    if (bal === 0n) continue;

    const usd = await usdOf(t, bal, meta.decimals, ethUsd);
    if (!Number.isFinite(usd) || usd < MIN_USD) continue;

    try {
      const q = await bestQuoteToWETH(t, bal);
      const pairLabel = `${q.sellToken}/${q.buyToken}`;
      console.log(`[rebalance] ${meta.symbol} -> WETH  size=${ethers.formatUnits(bal, meta.decimals)}  estOut=${ethers.formatUnits(q.buyAmount, 18)}`);

      const res = await baseSwapRouters.execBaseSwap(q, pairLabel, 0);
      if (res.success){
        sold++;
        const tr = {
          ts: Date.now(),
          router: q.router,
          pair: pairLabel,
          side: 'rebalance',
          sellToken: q.sellToken,
          buyToken:  q.buyToken,
          sellAmount: q.sellAmount,
          buyAmount:  q.buyAmount,
          sellUsd: usd,
          buyUsd: (Number(q.buyAmount)/1e18) * ethUsd,
          gasUsd: 0,
          netUsd: 0,
          txHash: res.txHash
        };
        try { tradesCsv && tradesCsv.appendTrade && tradesCsv.appendTrade(tr); } catch {}
        try { wsBus && wsBus.emitTrade && wsBus.emitTrade(tr); } catch {}
        console.log(`[rebalance] success ${pairLabel} tx=${res.txHash}`);
      } else {
        console.log(`[rebalance] fail ${pairLabel}: ${res.error || 'unknown error'}`);
      }
    } catch (e) {
      console.log(`[rebalance] skip ${t}: ${e.message}`);
    }
  }
  return { checked, sold };
}

function startRebalancer(){
  if (!/^true$/i.test(process.env.REBALANCE_ENABLE || 'false')) return;
  console.log(`[rebalance] enabled — every ${EVERY_SEC}s, min $${MIN_USD}, include stables=${INCLUDE_STABLES}`);
  // Wallet-wide seed at boot (bounded by env if provided)
  seedFromWalletLogs({
    fromBlock: process.env.WALLET_SCAN_FROM_BLOCK ? BigInt(process.env.WALLET_SCAN_FROM_BLOCK) : undefined,
    toBlock:   process.env.WALLET_SCAN_TO_BLOCK   ? BigInt(process.env.WALLET_SCAN_TO_BLOCK)   : undefined,
  }).then(()=>{
    // Optional CSV seed too
    const days = Number(process.env.REBALANCE_LOOKBACK_DAYS || '0');
    if (days > 0) seedFromCsvRange(days);
    // loop
    setInterval(() => {
      rebalanceOnce().catch(e => console.log('[rebalance] error', e.message));
    }, EVERY_SEC * 1000);
    setTimeout(() => { rebalanceOnce().catch(()=>{}); }, 10_000);
  }).catch(e => {
    console.log('[rebalance] wallet seed error', e.message);
  });
}

module.exports = { startRebalancer, rebalanceOnce, addWatchTokens, seedFromCsvRange, seedFromWalletLogs };
