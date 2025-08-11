// src/js/sizing.js — size sell amount by USD using UniV3 first, then UniV2 (BaseSwap) fallback
const { ethers } = require('ethers');
const { getEthUsd } = require('./priceOracle');
const { spotAmountOut } = require('./v3Spot');     // UniV3 spot quote
const { spotAmountOutV2 } = require('./v2Spot');   // UniV2 (BaseSwap) spot quote

const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || 8453);
const RPC_URL  = process.env.EVM_RPC_URL;

const WETH  = (process.env.WETH_ADDRESS  || '0x4200000000000000000000000000000000000006').toLowerCase();
const USDC  = (process.env.USDC_ADDRESS  || '0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913').toLowerCase();
const USDBC = (process.env.USDBC_ADDRESS || '0xeb466342c4d449bc9f53a865d5cb90586f405215').toLowerCase();

const V3_FEES = (process.env.UNI_V3_FEE_LIST || '500,3000,10000')
  .split(',')
  .map(s => parseInt(s.trim(), 10))
  .filter(n => Number.isFinite(n) && n > 0);

const ERC20_ABI = ['function decimals() view returns (uint8)'];

function getProvider() {
  if (!RPC_URL) throw new Error('EVM_RPC_URL missing');
  return new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
}

async function decimalsOf(addr) {
  const pvd = getProvider();
  try {
    const c = new ethers.Contract(addr, ERC20_ABI, pvd);
    return Number(await c.decimals());
  } catch {
    return 18;
  }
}

function asNumber(raw, decimals) {
  const scale = 10n ** BigInt(decimals);
  return Number(BigInt(raw)) / Number(scale);
}

async function usdPerToken(tokenAddr) {
  const t = tokenAddr.toLowerCase();
  if (t === USDC || t === USDBC) return 1;

  const dec = await decimalsOf(tokenAddr);
  const one = (10n ** BigInt(dec)).toString();
  const ethUsd = await getEthUsd();

  for (const fee of V3_FEES) {
    try { return asNumber(await spotAmountOut(tokenAddr, USDC,  fee, one), 6); } catch {}
    try { return asNumber(await spotAmountOut(tokenAddr, USDBC, fee, one), 6); } catch {}
  }

  try { return asNumber(await spotAmountOutV2(tokenAddr, USDC,  one), 6); } catch {}
  try { return asNumber(await spotAmountOutV2(tokenAddr, USDBC, one), 6); } catch {}

  if (t === WETH) {
    return (Number(one) / 1e18) * ethUsd;
  }

  for (const fee of V3_FEES) {
    try {
      const outW = await spotAmountOut(tokenAddr, WETH, fee, one);
      return asNumber(outW, 18) * ethUsd;
    } catch {}
  }
  try {
    const outW = await spotAmountOutV2(tokenAddr, WETH, one);
    return asNumber(outW, 18) * ethUsd;
  } catch {}

  throw new Error(`No USD pricing route for ${tokenAddr}`);
}

async function amountForUsdToken(_provider, tokenAddr, targetUsd) {
  const t = tokenAddr.toLowerCase();

  if (t === USDC || t === USDBC) {
    return BigInt(Math.ceil(targetUsd * 1e6));
  }
  if (t === WETH) {
    const ethUsd = await getEthUsd();
    const eth = targetUsd / ethUsd;
    return BigInt(Math.ceil(eth * 1e18));
  }

  const dec = await decimalsOf(tokenAddr);
  const usdPrice = await usdPerToken(tokenAddr);
  if (!Number.isFinite(usdPrice) || usdPrice <= 0) {
    throw new Error(`Could not determine USD value for token ${tokenAddr}`);
  }

  const qty = targetUsd / usdPrice;
  const raw = BigInt(Math.ceil(qty * 10 ** dec));
  return raw;
}

module.exports = { amountForUsdToken, usdPerToken, decimalsOf };
