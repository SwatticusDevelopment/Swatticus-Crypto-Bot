#!/usr/bin/env node
// scripts/rebalance-now.js
// One-shot rebalance all held tokens back to WETH on Base
// Options:
//   --wallet-scan                Scan the chain logs for the wallet (recommended)
//   --fromBlock  <n>             Start block for wallet scan (default 0)
//   --toBlock    <n>             End block for wallet scan (default latest)
//   --step       <blocks>        Block span per getLogs request (default from env WALLET_SCAN_STEP or 500)
//   --lookbackDays <n>           Also seed from last N days of CSVs (default 0 when wallet-scan used, else 3)
//   --include-stables            Also sell USDC/USDbC back to WETH
//   --extra 0xA,0xB              Extra token addresses to include
//
require('dotenv').config();
const { rebalanceOnce, addWatchTokens, seedFromCsvRange, seedFromWalletLogs } = require('../src/js/rebalancer');
const { ethers } = require('ethers');

const args = process.argv.slice(2);
function getArg(name, def=null){
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i+1]) return args[i+1];
  return def;
}
function toBigOrNull(v){
  if (v == null) return null;
  try { return BigInt(v); } catch { return null; }
}

const doWalletScan = args.includes('--wallet-scan');
const fromBlock = toBigOrNull(getArg('fromBlock', process.env.WALLET_SCAN_FROM_BLOCK));
let toBlockRaw  = toBigOrNull(getArg('toBlock', process.env.WALLET_SCAN_TO_BLOCK));
const toBlock   = (toBlockRaw === 0n) ? null : toBlockRaw; // 0 => latest
// const step      = Number(getArg('step', process.env.WALLET_SCAN_STEP || '500')) || 500;
const includeStables = args.includes('--include-stables') || /^true$/i.test(process.env.REBALANCE_INCLUDE_STABLES || 'false');
const defaultLookback = doWalletScan ? 0 : 3;
const lookbackDays = Number(getArg('lookbackDays', process.env.REBALANCE_LOOKBACK_DAYS || String(defaultLookback))) || defaultLookback;
const extraCsv       = getArg('extra', process.env.REBALANCE_EXTRA_TOKENS || '');

(async () => {
  if (includeStables) process.env.REBALANCE_INCLUDE_STABLES = 'true';
  if (doWalletScan){
    await seedFromWalletLogs({ fromBlock, toBlock });
  }
  if (lookbackDays > 0){
    seedFromCsvRange(lookbackDays);
  }
  if (extraCsv){
    const list = extraCsv.split(',').map(s=>s.trim()).filter(Boolean);
    addWatchTokens(list);
  }

  const { checked, sold } = await rebalanceOnce();
  console.log(`[rebalance-now] done — checked ${checked}, sold ${sold}`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
