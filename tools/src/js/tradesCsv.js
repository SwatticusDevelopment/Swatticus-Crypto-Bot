// src/js/tradesCsv.js
const fs = require('fs');
const path = require('path');

const DIR = process.env.TRADES_DIR || process.cwd();
const BASENAME = process.env.TRADES_BASENAME || 'trades';

function todayFile() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.resolve(DIR, `${BASENAME}-${y}-${m}-${dd}.csv`);
}

function ensureHeader(fp) {
  if (!fs.existsSync(fp) || fs.statSync(fp).size === 0) {
    const header = [
      'ts','router','pair','side','sellToken','buyToken',
      'sellAmountRaw','buyAmountRaw','sellUsd','buyUsd','gasUsd','netUsd','txHash'
    ].join(',') + '\n';
    fs.writeFileSync(fp, header);
  }
}

function csvSafe(v) {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g,'""')}"`
    : s;
}

function appendTrade(tr) {
  const fp = todayFile();
  ensureHeader(fp);
  const row = [
    tr.ts, tr.router, tr.pair, tr.side || 'sell',
    tr.sellToken, tr.buyToken, tr.sellAmount, tr.buyAmount,
    tr.sellUsd?.toFixed ? tr.sellUsd.toFixed(6) : tr.sellUsd,
    tr.buyUsd?.toFixed ? tr.buyUsd.toFixed(6) : tr.buyUsd,
    tr.gasUsd?.toFixed ? tr.gasUsd.toFixed(6) : tr.gasUsd,
    tr.netUsd?.toFixed ? tr.netUsd.toFixed(6) : tr.netUsd,
    tr.txHash
  ].map(csvSafe).join(',') + '\n';
  fs.appendFileSync(fp, row);
  return fp;
}

module.exports = { appendTrade, todayFile };
