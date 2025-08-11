// src/js/profitGuard.js — robust profitability check (ethers v6) with V2 fallback
const { ethers } = require('ethers');
const { getEthUsd } = require('./priceOracle');
const { spotAmountOut }   = require('./v3Spot');
const { spotAmountOutV2 } = require('./v2Spot');

const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || 8453);

const WETH = (process.env.WETH_ADDRESS  || '0x4200000000000000000000000000000000000006').toLowerCase();
const USDC = (process.env.USDC_ADDRESS  || '0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913').toLowerCase();
const USDBC= (process.env.USDBC_ADDRESS || '0xeb466342c4d449bc9f53a865d5cb90586f405215').toLowerCase();

const V3_FEES = (process.env.UNI_V3_FEE_LIST || '500,3000,10000')
  .split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);

const GAS_DEFAULTS = {
  baseswap: parseInt(process.env.GAS_ESTIMATE_UNIV2 || '220000', 10),
  univ2:    parseInt(process.env.GAS_ESTIMATE_UNIV2 || '220000', 10),
  univ3:    parseInt(process.env.GAS_ESTIMATE_UNIV3 || '300000', 10)
};

function getProvider() {
  if (!process.env.EVM_RPC_URL) throw new Error('EVM_RPC_URL missing');
  return new ethers.JsonRpcProvider(process.env.EVM_RPC_URL, CHAIN_ID);
}

async function gasPriceWei(pvd){
  if (process.env.FIXED_GAS_PRICE_WEI) {
    try { return BigInt(process.env.FIXED_GAS_PRICE_WEI); } catch {}
  }
  const fee = await pvd.getFeeData();
  return (fee.maxFeePerGas ?? fee.gasPrice ?? 100_000_000n);
}

function asNumber(raw, decimals){
  const d = BigInt(decimals);
  const scale = 10n ** d;
  return Number(raw) / Number(scale);
}

async function usdValueOf(tokenAddr, rawAmount, ethUsd){
  const t = tokenAddr.toLowerCase();
  const amt = BigInt(rawAmount);
  if (t === USDC || t === USDBC) return Number(amt) / 1e6;
  if (t === WETH) return (Number(amt) / 1e18) * ethUsd;

  for (const fee of V3_FEES) {
    try { return Number(BigInt(await spotAmountOut(tokenAddr, USDC,  fee, amt.toString()))) / 1e6; } catch {}
    try { return Number(BigInt(await spotAmountOut(tokenAddr, USDBC, fee, amt.toString()))) / 1e6; } catch {}
  }
  try { return Number(BigInt(await spotAmountOutV2(tokenAddr, USDC,  amt.toString()))) / 1e6; } catch {}
  try { return Number(BigInt(await spotAmountOutV2(tokenAddr, USDBC, amt.toString()))) / 1e6; } catch {}

  for (const fee of V3_FEES) {
    try {
      const outW = await spotAmountOut(tokenAddr, WETH, fee, amt.toString());
      return (Number(BigInt(outW)) / 1e18) * ethUsd;
    } catch {}
  }
  try {
    const outW = await spotAmountOutV2(tokenAddr, WETH, amt.toString());
    return (Number(BigInt(outW)) / 1e18) * ethUsd;
  } catch {}
  return null;
}

/**
 * @param {Object} params
 * @param {number} params.chainId
 * @param {string} params.pair
 * @param {string} params.side
 * @param {bigint} params.sellAmountWei
 * @param {Object} params.normQuote
 */
async function check(params) {
  const pvd = getProvider();

  const router = (params.normQuote.router || 'baseswap').toLowerCase();
  const gasUnits = GAS_DEFAULTS[router] || GAS_DEFAULTS.univ2;

  const gasWei = await gasPriceWei(pvd);
  const gasCostEth = Number(gasWei) * gasUnits / 1e18;

  let ethUsd = 0;
  try { ethUsd = await getEthUsd(); }
  catch { ethUsd = Number(process.env.FALLBACK_ETH_USD || '3200'); }

  const gasUsd = gasCostEth * ethUsd;

  const sellToken = params.normQuote.sellToken;
  const buyToken  = params.normQuote.buyToken;

  const sellAmt = BigInt(params.sellAmountWei ?? params.normQuote.sellAmount);
  const buyAmt  = BigInt(params.normQuote.buyAmount);

  const sellUsd = await usdValueOf(sellToken, sellAmt, ethUsd);
  const buyUsd  = await usdValueOf(buyToken,  buyAmt,  ethUsd);

  if (sellUsd == null || buyUsd == null) {
    return { ok: false, netUsd: 0, gasUsd, reason: 'unpriceable' };
  }

  const grossUsd = buyUsd - sellUsd;
  const netUsd   = grossUsd - gasUsd;

  const minUsd = Number(process.env.MIN_USD_PROFIT || '1');
  const ok = netUsd >= minUsd;

  return {
    ok,
    netUsd: Number(netUsd.toFixed ? netUsd.toFixed(6) : netUsd),
    gasUsd,
    router,
    sellUsd,
    buyUsd,
    grossUsd
  };
}

module.exports = { check };
