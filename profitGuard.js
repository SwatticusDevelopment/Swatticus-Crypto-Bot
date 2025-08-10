// profitGuard.js
// Optional: basic guard check stub. Always running; only enforces if you wire it into execution path.
// To enforce globally, set ENFORCE_PROFIT_GUARD=true and make your executor call isProfitable(...) before sending.

const minUsd = parseFloat(process.env.MIN_USD_PROFIT || '0.5');

function isUsdcPair(pair) {
  return pair && pair.toUpperCase().includes('/USDC');
}

// Simplified check: if buying USDC (X/USDC), ensure buyAmount exceeds a rough threshold.
// Real-world: convert both legs to USD using a price oracle.
function isProfitable({ pair, router, normQuote }) {
  if (process.env.ENFORCE_PROFIT_GUARD !== 'true') return true;
  if (!isUsdcPair(pair)) return true; // skip if not USDC leg; requires oracle
  try {
    const buy = BigInt(normQuote.buyAmount || '0');
    // Assume 6 decimals for USDC; minUsd -> micro USDC
    const floor = BigInt(Math.floor(minUsd * 1e6));
    return buy >= floor;
  } catch { return false; }
}

// Auto-exec: no-op here; wire into your send path manually.
module.exports = { isProfitable };
