// src/js/chainWorker.js - UPDATED with better error handling and execution flow
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
  const r = parseFloat(val || '1');
  return Math.max(1000, Math.floor(1000 / Math.max(r, 0.1))); // Minimum 1 second
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

/** -------------------- enhanced attempt with better execution flow -------------------- */
async function attemptOnce(chain, chainId, pairLabel, baseUsd, fromAddress) {
  let provider;
  const startTime = Date.now();
  
  try {
    const { sell, buy } = parsePairLabel(pairLabel);

    // Resolve token symbols or addresses to canonical addresses
    const sellToken = await resolveToken(sell);
    const buyToken = await resolveToken(buy);

    // Use our robust provider
    provider = getProvider();

    // Size trade: get N wei of sellToken worth `baseUsd`
    console.log(`[attempt] Sizing trade: ${baseUsd} worth of ${sell}...`);
    let sellAmount;
    try {
      sellAmount = await amountForUsdToken(provider, sellToken, baseUsd);
      console.log(`[attempt] Trade size: ${sellAmount.toString()} wei of ${sell}`);
    } catch (sizingError) {
      log.warn('sizing_error', { 
        pair: pairLabel, 
        msg: `Cannot size trade: ${sizingError.message}` 
      });
      return;
    }

    // Check wallet balance before getting quotes
    const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
    try {
      const tokenContract = new ethers.Contract(sellToken, ERC20_ABI, provider);
      const balance = await tokenContract.balanceOf(fromAddress);
      
      if (balance < sellAmount) {
        log.info('insufficient_balance', { 
          pair: pairLabel, 
          required: sellAmount.toString(),
          available: balance.toString(),
          msg: 'Insufficient balance for trade'
        });
        return;
      }
      console.log(`[attempt] ✅ Sufficient balance: ${balance.toString()} >= ${sellAmount.toString()}`);
    } catch (balanceError) {
      log.warn('balance_check_failed', { 
        pair: pairLabel, 
        msg: `Balance check failed: ${balanceError.message}` 
      });
      // Continue anyway - the execution will catch this
    }

    // Get best quote with fallbacks
    console.log(`[attempt] Getting quotes for ${pairLabel}...`);
    const bestQuote = await getBestQuote(sellToken, buyToken, sellAmount);
    if (!bestQuote) {
      log.warn('noquote', { pair: pairLabel, msg: 'no valid quotes from any router' });
      return;
    }

    console.log(`[attempt] ✅ Best quote: ${bestQuote.router} - ${ethers.formatEther(bestQuote.buyAmount)} output`);

    // Profitability guard
    console.log(`[attempt] Checking profitability...`);
    const guard = await profitCheck({
      chainId,
      pair: pairLabel,
      side: 'sell',
      sellAmountWei: sellAmount,
      normQuote: bestQuote
    });

    if (!guard.ok) {
      log.info('skip', { 
        pair: pairLabel, 
        reason: 'profit_guard', 
        netUsd: guard.netUsd, 
        router: bestQuote.router,
        msg: `Unprofitable: ${guard.netUsd}` 
      });
      return;
    }

    log.info('opportunity', { 
      pair: pairLabel, 
      router: bestQuote.router, 
      estNetUsd: guard.netUsd,
      gasUsd: guard.gasUsd,
      grossUsd: guard.grossUsd,
      msg: `Estimated profit: ${guard.netUsd}` 
    });

    // Pre-execution checks
    console.log(`[attempt] Performing pre-execution checks...`);
    
    // Check if we need approval
    const needsApproval = await checkApprovalNeeded(sellToken, fromAddress, sellAmount);
    if (needsApproval) {
      console.log(`[attempt] ⚠️  Pre-check: Token approval will be needed`);
    } else {
      console.log(`[attempt] ✅ Pre-check: Token already approved`);
    }

    // Check ETH balance for gas
    const ethBalance = await provider.getBalance(fromAddress);
    const estimatedGasCost = BigInt(guard.gasUsd * 1e6) * BigInt(4270) / BigInt(1e6); // Rough ETH cost
    if (ethBalance < estimatedGasCost) {
      log.warn('low_eth', { 
        pair: pairLabel, 
        ethBalance: ethBalance.toString(),
        estimatedCost: estimatedGasCost.toString(),
        msg: 'Low ETH balance for gas' 
      });
    }

    // Execute with enhanced logging
    console.log(`[attempt] 🚀 Executing trade...`);
    const executionStart = Date.now();
    
    const res = await execByRouter(chainId, bestQuote.router, bestQuote, pairLabel, guard.netUsd);
    
    const executionTime = Date.now() - executionStart;
    const totalTime = Date.now() - startTime;
    
    if (res && res.success) {
      log.info('success', { 
        router: bestQuote.router, 
        pair: pairLabel, 
        txHash: res.txHash, 
        estNetUsd: guard.netUsd,
        sellAmount: bestQuote.sellAmount,
        buyAmount: bestQuote.buyAmount,
        gasUsed: res.gasUsed,
        executionTimeMs: executionTime,
        totalTimeMs: totalTime,
        approvalTx: res.approvalTx,
        msg: `SUCCESSFUL TRADE! Profit: ${guard.netUsd}`
      });
      
      // Update success metrics
      runner.consecutiveErrors = 0;
      runner.lastSuccessTime = Date.now();
      runner.totalSuccessfulTrades = (runner.totalSuccessfulTrades || 0) + 1;
      runner.totalProfit = (runner.totalProfit || 0) + guard.netUsd;
      
      console.log(`[attempt] 🎉 TRADE #${runner.totalSuccessfulTrades} SUCCESSFUL!`);
      console.log(`[attempt] 💰 Session profit: ${runner.totalProfit.toFixed(2)}`);
      
    } else {
      log.warn('fail', { 
        router: bestQuote.router, 
        pair: pairLabel, 
        txHash: (res && res.txHash) || '', 
        error: (res && res.error) || 'unknown error',
        executionTimeMs: executionTime,
        totalTimeMs: totalTime,
        approvalTx: res && res.approvalTx,
        msg: `TRADE FAILED: ${(res && res.error) || 'unknown error'}` 
      });
      
      runner.consecutiveErrors++;
    }
    
  } catch (e) {
    const errorMsg = e.shortMessage || e.message || String(e);
    runner.consecutiveErrors++;
    
    // Categorize errors for better handling
    if (errorMsg.includes('compute units') || errorMsg.includes('rate limit')) {
      log.warn('ratelimit', { pair: pairLabel, msg: 'Rate limited, backing off' });
    } else if (errorMsg.includes('No pool found') || errorMsg.includes('No USD pricing route')) {
      log.info('nopool', { pair: pairLabel, msg: 'No suitable pool/route available' });
    } else if (errorMsg.includes('insufficient funds') || errorMsg.includes('Insufficient')) {
      log.warn('insufficient_funds', { pair: pairLabel, msg: errorMsg });
    } else if (errorMsg.includes('nonce') || errorMsg.includes('replacement')) {
      log.warn('nonce_error', { pair: pairLabel, msg: errorMsg });
    } else {
      log.error('error', { pair: pairLabel, msg: errorMsg });
    }
  }
}

// Helper function to check if approval is needed
async function checkApprovalNeeded(tokenAddress, walletAddress, requiredAmount) {
  try {
    const BASESWAP_ROUTER = process.env.BASESWAP_ROUTER || '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86';
    const provider = getProvider();
    
    const ERC20_ABI = ['function allowance(address,address) view returns (uint256)'];
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    
    const currentAllowance = await tokenContract.allowance(walletAddress, BASESWAP_ROUTER);
    return currentAllowance < requiredAmount;
  } catch {
    return true; // Assume approval needed if check fails
  }
}

/** -------------------- enhanced runner with performance tracking -------------------- */
const runner = {
  timer: null,
  running: false,
  pairs: [],
  baseUsd: 15,
  intervalMs: 2000,
  idx: 0,
  consecutiveErrors: 0,
  lastSuccessTime: Date.now(),
  totalSuccessfulTrades: 0,
  totalProfit: 0,
  startTime: Date.now()
};

function rpcInterval() {
  const chain = (cfg.EVM_CHAIN || 'base').toUpperCase();
  const key = `${chain}_RPC_RPS`;
  const rps = process.env[key] || process.env.BASE_RPC_RPS || '1';
  return Math.max(1000, intervalFromRps(rps)); // Minimum 1 second
}

function isRunning() { return runner.running; }

function adjustInterval() {
  const timeSinceSuccess = Date.now() - runner.lastSuccessTime;
  const originalInterval = rpcInterval();
  
  if (runner.consecutiveErrors > 10) {
    // Too many errors, slow down significantly
    runner.intervalMs = Math.min(originalInterval * 3, 30000); // Max 30 seconds
    console.log(`[bot] Too many errors (${runner.consecutiveErrors}), slowing to ${runner.intervalMs}ms intervals`);
  } else if (runner.consecutiveErrors > 5) {
    // Some errors, slow down moderately
    runner.intervalMs = Math.min(originalInterval * 2, 15000); // Max 15 seconds
    console.log(`[bot] Some errors (${runner.consecutiveErrors}), slowing to ${runner.intervalMs}ms intervals`);
  } else if (runner.consecutiveErrors === 0 && runner.totalSuccessfulTrades > 0) {
    // Recent success, can maintain or slightly increase speed
    runner.intervalMs = Math.max(originalInterval, 1500); // Min 1.5 seconds
  } else {
    // Default interval
    runner.intervalMs = originalInterval;
  }
}

function getSessionStats() {
  const runtimeMinutes = (Date.now() - runner.startTime) / 60000;
  const successRate = runner.totalSuccessfulTrades > 0 ? 
    (runner.totalSuccessfulTrades / (runner.totalSuccessfulTrades + runner.consecutiveErrors)) * 100 : 0;
  
  return {
    runtime: `${runtimeMinutes.toFixed(1)}m`,
    trades: runner.totalSuccessfulTrades,
    profit: `${(runner.totalProfit || 0).toFixed(2)}`,
    successRate: `${successRate.toFixed(1)}%`,
    errorStreak: runner.consecutiveErrors
  };
}

function start() {
  if (runner.running) return { running: true };

  const chainId = parseInt(process.env.EVM_CHAIN_ID || '8453', 10);
  runner.pairs = loadPairs();
  runner.baseUsd = parseFloat(process.env.BASE_TRADE_USD || '15');
  runner.intervalMs = rpcInterval();
  runner.running = true;
  runner.consecutiveErrors = 0;
  runner.startTime = Date.now();

  log.info('boot', {
    msg: 'Enhanced bot started with robust execution',
    chainId,
    pairs: runner.pairs.slice(0, 5).join('|') + (runner.pairs.length > 5 ? `|...(+${runner.pairs.length - 5})` : ''),
    baseUsd: runner.baseUsd,
    intervalMs: runner.intervalMs,
    totalPairs: runner.pairs.length
  });

  console.log(`[bot] 🚀 Enhanced Swatticus bot starting!`);
  console.log(`[bot] 📊 Trading pairs: ${runner.pairs.length}`);
  console.log(`[bot] 💰 Trade size: ${runner.baseUsd}`);
  console.log(`[bot] ⏱️  Scan interval: ${runner.intervalMs}ms`);
  console.log(`[bot] 🎯 Min profit: ${process.env.MIN_PROFIT_USD || 3}`);

  runner.timer = setInterval(async () => {
    try {
      if (!runner.pairs.length) return;
      
      const pair = runner.pairs[runner.idx % runner.pairs.length];
      runner.idx = (runner.idx + 1) % runner.pairs.length;

      // Show periodic stats
      if (runner.idx % 20 === 0 && runner.totalSuccessfulTrades > 0) {
        const stats = getSessionStats();
        console.log(`[bot] 📊 Session stats: ${stats.trades} trades, ${stats.profit}, ${stats.successRate} success, ${stats.runtime}`);
      }

      log.info('tick', { msg: 'scanning pair', pair });
      
      const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, getProvider());
      const from = await wallet.getAddress();

      await attemptOnce(cfg.EVM_CHAIN, chainId, pair, runner.baseUsd, from);
      
    } catch (e) {
      const m = e.shortMessage || e.message || String(e);
      runner.consecutiveErrors++;
      
      // Don't log every rate limit error
      if (!m.includes('compute units') && !m.includes('rate limit')) {
        log.error('error', { msg: m });
      }
      
      // Adaptive backoff on errors
      if (runner.consecutiveErrors % 10 === 0) {
        console.log(`[bot] ⚠️  ${runner.consecutiveErrors} consecutive errors, implementing backoff...`);
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
  
  const stats = getSessionStats();
  console.log(`[bot] 🛑 Bot stopped after ${stats.runtime}`);
  console.log(`[bot] 📊 Final stats: ${stats.trades} trades, ${stats.profit}, ${stats.successRate} success`);
  
  log.info('boot', { 
    msg: 'Enhanced bot stopped',
    ...stats
  });
  
  return { running: false };
}

module.exports = { start, stop, isRunning, getSessionStats };