// src/js/chainWorker.js - Updated worker with robust error handling
const { ethers } = require('ethers');
const cfg = require('./multichainConfig');
const { getBestQuote } = require('./robustQuoter');
const { execByRouter } = require('./evmExecutors');
const { check: profitCheck } = require('./profitGuard');
const { amountForUsdToken } = require('./sizing');
const { resolveToken } = require('./tokenResolver');
const { getProvider } = require('./robustProvider');
const log = require('./logger');
const fs = require('fs');
const path = require('path');

/** -------------------- helpers -------------------- */
function intervalFromRps(val) {
  const r = parseFloat(val || '0.5');
  return Math.max(2000, Math.floor(1000 / Math.max(r, 0.1))); // Much more conservative
}

function toAddrLower(v) {
  return String(v || '').trim().toLowerCase();
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
  let provider;
  try {
    const { sell, buy } = parsePairLabel(pairLabel);

    // Resolve token symbols or addresses to canonical addresses
    const sellToken = await resolveToken(sell);
    const buyToken = await resolveToken(buy);

    // Use our robust provider
    provider = getProvider();

    // Size trade: get N wei of sellToken worth `baseUsd`
    const sellAmount = await amountForUsdToken(provider, sellToken, baseUsd);

    // Get best quote with fallbacks
    const bestQuote = await getBestQuote(sellToken, buyToken, sellAmount);
    if (!bestQuote) {
      log.warn('noquote', { pair: pairLabel, msg: 'no valid quotes from any router' });
      return;
    }

    // Profitability guard
    const guard = await profitCheck({
      chainId,
      pair: pairLabel,
      side: 'sell',
      sellAmountWei: sellAmount,
      normQuote: bestQuote
    });

    if (!guard.ok) {
      log.info('skip', { pair: pairLabel, reason: 'profit_guard', netUsd: guard.netUsd, router: bestQuote.router });
      return;
    }

    log.info('opportunity', { 
      pair: pairLabel, 
      router: bestQuote.router, 
      estNetUsd: guard.netUsd,
      msg: `Estimated profit: $${guard.netUsd}` 
    });

    // Execute
    const res = await execByRouter(chainId, bestQuote.router, bestQuote, pairLabel, guard.netUsd);
    if (res && res.success) {
      log.info('success', { 
        router: bestQuote.router, 
        pair: pairLabel, 
        txHash: res.txHash, 
        estNetUsd: guard.netUsd,
        sellAmount: bestQuote.sellAmount,
        buyAmount: bestQuote.buyAmount
      });
    } else {
      log.warn('fail', { 
        router: bestQuote.router, 
        pair: pairLabel, 
        txHash: (res && res.txHash) || '', 
        msg: (res && res.error) || 'tx failed' 
      });
    }
  } catch (e) {
    const errorMsg = e.shortMessage || e.message || String(e);
    
    // Don't spam logs with known rate limit errors
    if (errorMsg.includes('compute units') || errorMsg.includes('rate limit')) {
      log.warn('ratelimit', { pair: pairLabel, msg: 'rate limited, backing off' });
    } else if (errorMsg.includes('No pool found') || errorMsg.includes('No USD pricing route')) {
      log.info('nopool', { pair: pairLabel, msg: 'no suitable pool/route' });
    } else {
      log.error('error', { pair: pairLabel, msg: errorMsg });
    }
  }
}

/** -------------------- runner -------------------- */
const runner = {
  timer: null,
  running: false,
  pairs: [],
  baseUsd: 30,
  intervalMs: 3000, // Start with 3 second intervals
  idx: 0,
  consecutiveErrors: 0,
  lastSuccessTime: Date.now()
};

function rpcInterval() {
  // Much more conservative intervals to avoid rate limits
  const chain = (cfg.EVM_CHAIN || 'base').toUpperCase();
  const key = `${chain}_RPC_RPS`;
  const rps = process.env[key] || process.env.BASE_RPC_RPS || '0.5';
  return Math.max(3000, intervalFromRps(rps)); // Minimum 3 seconds
}

function isRunning() { return runner.running; }

function adjustInterval() {
  const timeSinceSuccess = Date.now() - runner.lastSuccessTime;
  
  if (runner.consecutiveErrors > 10) {
    // Too many errors, slow down significantly
    runner.intervalMs = Math.min(runner.intervalMs * 2, 30000); // Max 30 seconds
    console.log(`[bot] Too many errors, slowing to ${runner.intervalMs}ms intervals`);
  } else if (runner.consecutiveErrors === 0 && timeSinceSuccess < 60000) {
    // Recent success, can speed up slightly
    runner.intervalMs = Math.max(runner.intervalMs * 0.9, 2000); // Min 2 seconds
  }
}

function start() {
  if (runner.running) return { running: true };

  const chainId = parseInt(process.env.EVM_CHAIN_ID || '8453', 10);
  runner.pairs = loadPairs();
  runner.baseUsd = parseFloat(process.env.BASE_TRADE_USD || '10'); // Smaller default
  runner.intervalMs = Math.max(3000, parseInt(rpcInterval(), 10));
  runner.running = true;
  runner.consecutiveErrors = 0;

  log.info('boot', {
    msg: 'bot started with robust error handling',
    chainId,
    pairs: runner.pairs.slice(0, 5).join('|') + (runner.pairs.length > 5 ? `|...(+${runner.pairs.length - 5})` : ''),
    baseUsd: runner.baseUsd,
    intervalMs: runner.intervalMs
  });

  runner.timer = setInterval(async () => {
    try {
      if (!runner.pairs.length) return;
      
      const pair = runner.pairs[runner.idx % runner.pairs.length];
      runner.idx = (runner.idx + 1) % runner.pairs.length;

      log.info('tick', { msg: 'scanning pair', pair });
      
      const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, getProvider());
      const from = await wallet.getAddress();

      await attemptOnce(cfg.EVM_CHAIN, chainId, pair, runner.baseUsd, from);
      
      // Success - reset error counter
      runner.consecutiveErrors = 0;
      runner.lastSuccessTime = Date.now();
      
    } catch (e) {
      const m = e.shortMessage || e.message || String(e);
      runner.consecutiveErrors++;
      
      // Don't log every rate limit error
      if (!m.includes('compute units') && !m.includes('rate limit')) {
        log.error('error', { msg: m });
      }
      
      // Adaptive backoff on errors
      if (runner.consecutiveErrors % 5 === 0) {
        console.log(`[bot] ${runner.consecutiveErrors} consecutive errors, backing off...`);
        await new Promise(r => setTimeout(r, Math.min(runner.consecutiveErrors * 1000, 10000)));
      }
    }
    
    // Adjust intervals based on recent performance
    if (runner.idx % 10 === 0) {
      adjustInterval();
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