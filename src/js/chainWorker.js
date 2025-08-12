// chainWorker.js — full worker scanning pairs list (excludes WETH/USDC if configured)
const { ethers } = require('ethers');
const cfg = require('./multichainConfig');
const { fanoutQuotes } = require('./evmRouters');
const { execByRouter } = require('./evmExecutors');
const { check: profitCheck } = require('./profitGuard');
const { amountForUsdToken } = require('./sizing');
const { resolveToken } = require('./tokenResolver');
const log = require('./logger');
const fs = require('fs');
const path = require('path');

/** -------------------- helpers -------------------- */
function intervalFromRps(val) {
  const r = parseFloat(val || '0.5');
  return Math.max(200, Math.floor(1000 / Math.max(r, 0.01)));
}

function toAddrLower(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizeQuote(q, sellToken, buyToken, sellAmount) {
  if (!q || typeof q !== 'object') return null;
  const router = q.router || 'unknown';
  // Expect strings for amounts; coerce to BigInt strings if needed
  const out = {
    router,
    sellToken,
    buyToken,
    sellAmount: typeof q.sellAmount === 'string' ? q.sellAmount : (typeof sellAmount === 'bigint' ? sellAmount.toString() : String(q.sellAmount || sellAmount || '0')),
    buyAmount: typeof q.buyAmount === 'string' ? q.buyAmount : String(q.buyAmount || '0'),
    original: q
  };
  return out;
}

async function chooseBest(chain, chainId, sellToken, buyToken, sellAmount) {
  const quotes = await fanoutQuotes(chain, chainId, sellToken, buyToken, sellAmount);
  const normalized = quotes.map(q => normalizeQuote(q, sellToken, buyToken, sellAmount)).filter(Boolean);
  // pick max buyAmount
  normalized.sort((a, b) => {
    const ab = BigInt(a.buyAmount || '0');
    const bb = BigInt(b.buyAmount || '0');
    if (ab === bb) return 0;
    return ab > bb ? -1 : 1;
  });
  return normalized[0] || null;
}

function parsePairLabel(label) {
  const [a, b] = String(label).split('/').map(s => s.trim());
  if (!a || !b) throw new Error(`Bad pair label: ${label}`);
  return { sell: a, buy: b };
}

function uniq(arr) {
  const s = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x).trim();
    if (!s.has(k)) {
      s.add(k);
      out.push(k);
    }
  }
  return out;
}

function normalizePairStr(a, b) {
  return `${toAddrLower(a)}/${toAddrLower(b)}`;
}

function loadPairs() {
  // Prefer JSON file if provided
  const file = process.env.EVM_PAIRS_FILE ? path.resolve(process.cwd(), process.env.EVM_PAIRS_FILE) : null;
  let fromFile = [];
  if (file && fs.existsSync(file)) {
    try {
      const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(arr)) fromFile = arr.map(s => String(s).trim()).filter(Boolean);
      console.log(`[pairs] Loaded ${fromFile.length} from ${file}`);
    } catch (e) {
      console.warn('[pairs] failed to read EVM_PAIRS_FILE:', e.message || String(e));
    }
  }
  const fromEnv = String(process.env.EVM_PAIRS || '').split(',').map(s => s.trim()).filter(Boolean);
  let pairs = uniq([...(fromFile || []), ...(fromEnv || [])]);
  if (pairs.length === 0) pairs = ['WETH/USDC']; // fallback

  // Apply exclusions if provided
  const ex = String(process.env.EVM_PAIR_EXCLUDE || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ex.length) {
    const exSet = new Set();
    for (const p of ex) {
      const [x, y] = String(p).split('/').map(s => s.trim().toLowerCase());
      if (x && y) {
        exSet.add(`${x}/${y}`);
        exSet.add(`${y}/${x}`); // bidirectional
      }
    }
    pairs = pairs.filter(p => {
      const [x, y] = p.split('/').map(s => s.trim().toLowerCase());
      return !(exSet.has(`${x}/${y}`));
    });
  }
  return pairs;
}

/** -------------------- core attempt -------------------- */
async function attemptOnce(chain, chainId, pairLabel, baseUsd, fromAddress) {
  try {
    const { sell, buy } = parsePairLabel(pairLabel);

    // Resolve token symbols or addresses to canonical addresses
    const sellToken = await resolveToken(sell);
    const buyToken = await resolveToken(buy);

    // Provider
    const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL, chainId);

    // Size trade: get N wei of sellToken worth `baseUsd`
    const sellAmount = await amountForUsdToken(provider, sellToken, baseUsd);

    // Fanout quotes across configured routers
    const best = await chooseBest(cfg.EVM_CHAIN, chainId, sellToken, buyToken, sellAmount);
    if (!best) {
      log.warn('noquote', { pair: pairLabel, msg: 'no valid quotes' });
      return;
    }

    // Profitability guard
    const guard = await profitCheck({
      chainId,
      pair: pairLabel,
      side: 'sell',
      sellAmountWei: sellAmount,
      normQuote: best
    });

    if (!guard.ok) {
      log.info('skip', { pair: pairLabel, reason: 'profit_guard', netUsd: guard.netUsd });
      return;
    }

    // Execute
    const res = await execByRouter(chainId, best.router, best, pairLabel, guard.netUsd);
    if (res && res.success) {
      log.info('success', { router: best.router, pair: pairLabel, txHash: res.txHash, estNetUsd: guard.netUsd });
    } else {
      log.warn('fail', { router: best.router, pair: pairLabel, txHash: (res && res.txHash) || '', msg: (res && res.error) || 'tx failed' });
    }
  } catch (e) {
    log.error('error', { pair: pairLabel, msg: e.shortMessage || e.message || String(e) });
  }
}

/** -------------------- runner -------------------- */
const runner = {
  timer: null,
  running: false,
  pairs: [],
  baseUsd: 30,
  intervalMs: 1000,
  idx: 0
};

function rpcInterval() {
  // Allow chain-specific RPS (e.g., BASE_RPC_RPS) or fallback BASE_RPC_RPS
  const chain = (cfg.EVM_CHAIN || 'base').toUpperCase();
  const key = `${chain}_RPC_RPS`;
  const rps = process.env[key] || process.env.BASE_RPC_RPS || '0.5';
  return intervalFromRps(rps);
}

function isRunning() { return runner.running; }

function start() {
  if (runner.running) return { running: true };

  const chainId = parseInt(process.env.EVM_CHAIN_ID || '8453', 10);
  runner.pairs = loadPairs();
  runner.baseUsd = parseFloat(process.env.BASE_TRADE_USD || '30');
  runner.intervalMs = Math.max(200, parseInt(rpcInterval(), 10));
  runner.running = true;

  log.info('boot', {
    msg: 'bot started',
    chainId,
    pairs: runner.pairs.slice(0, 10).join('|') + (runner.pairs.length > 10 ? `|...(+${runner.pairs.length - 10})` : ''),
    baseUsd: runner.baseUsd,
    intervalMs: runner.intervalMs
  });

  runner.timer = setInterval(async () => {
    try {
      if (!runner.pairs.length) return;
      const pair = runner.pairs[runner.idx % runner.pairs.length];
      runner.idx = (runner.idx + 1) % runner.pairs.length;

      log.info('tick', { msg: 'quote fanout', pair });
      const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, new ethers.JsonRpcProvider(process.env.EVM_RPC_URL, chainId));
      const from = await wallet.getAddress();

      await attemptOnce(cfg.EVM_CHAIN, chainId, pair, runner.baseUsd, from);
    } catch (e) {
      const m = e.shortMessage || e.message || String(e);
      log.error('error', { msg: m });
      // brief backoff if something noisy happens
      await new Promise(r => setTimeout(r, Math.min(runner.intervalMs * 2, 8000)));
    }
  }, runner.intervalMs);

  return { running: true };
}

function stop() {
  if (runner.timer) {
    clearInterval(runner.timer);
    runner.timer = null;
  }
  runner.running = false;
  log.info('boot', { msg: 'bot stopped' });
  return { running: false };
}

module.exports = { start, stop, isRunning };
