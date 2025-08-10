// evmRouters.js
const fetch = require('node-fetch');
const cfg = require('./multichainConfig');

const rps = (k, d) => parseFloat(process.env[k] || d);
const wait = ms => new Promise(r => setTimeout(r, ms));

async function throttled(url, opts, key) {
  const per = 1000 / rps(key, 0.5);
  await wait(per);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function q0x(p) {
  const headers = cfg.OX_API_KEY ? { '0x-api-key': cfg.OX_API_KEY } : {};
  const url = `${cfg.OX_QUOTE_URL}?${new URLSearchParams(p)}`;
  const data = await throttled(url, { headers }, 'RATE_0X_RPS');
  return { router: '0x', data };
}

async function fanoutQuotes(chainId, sellToken, buyToken, sellAmount) {
  const enabled = (process.env[`${(process.env.EVM_CHAIN||'base').toUpperCase()}_ROUTERS`] || '0x')
    .split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  const tasks = [];
  for (const r of enabled) {
    if (r==='0x') tasks.push(q0x({ sellToken, buyToken, sellAmount }));
    // Additional routers can be added here using ENV endpoints/keys.
  }
  const out = [];
  for (const t of tasks) { try { out.push(await t); } catch {} }
  return out;
}

module.exports = { fanoutQuotes };
