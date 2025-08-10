// chainWorker.js (ethers v6 compatible)
const ethers = require('ethers');
const { fanoutQuotes } = require('./evmRouters');
const { execute } = require('./evmSwap');

function intervalFromRps(val) { const r = parseFloat(val||'0.5'); return Math.max(1000/Math.max(r,0.01), 1000); }

function normalizeQuote(q) {
  const { router, data } = q;
  if (router==='0x') return { router, buyAmount: data.buyAmount, to: data.to, data: data.data, value: data.value||'0', gas: data.gas||'0' };
  return { router, buyAmount: '0' };
}

async function attemptOnce(chainId, pair, amountWei) {
  const [sellToken, buyToken] = pair.split('/');
  const quotes = await fanoutQuotes(chainId, sellToken, buyToken, amountWei);
  const norm = quotes.map(normalizeQuote).sort((a,b)=> (BigInt(b.buyAmount||'0') - BigInt(a.buyAmount||'0')));
  const best = norm[0];
  if (!best || !best.buyAmount || BigInt(best.buyAmount)===0n) return;
  await execute(best, best.router);
}

function startChainWorker(rpcUrl, chainId, pairs, baseAmountWei) {
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
  const intMs = intervalFromRps(process.env[`${(process.env.EVM_CHAIN||'base').toUpperCase()}_RPC_RPS`]);
  const timer = setInterval(async () => {
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    try { await attemptOnce(chainId, pair, baseAmountWei); } catch {}
  }, intMs);
  return () => clearInterval(timer);
}

module.exports = { startChainWorker };
