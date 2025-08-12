// src/js/pnlStore.js
const fs = require('fs');
const { todayFile } = require('./tradesCsv');

const state = { realizedUsd: 0, count: 0 };

function initFromTodayCsv() {
  try {
    const fp = todayFile();
    if (!fs.existsSync(fp)) return;
    const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const netUsd = parseFloat(cols[11] || '0');
      if (Number.isFinite(netUsd)) {
        state.realizedUsd += netUsd;
        state.count += 1;
      }
    }
  } catch {}
}

function addTrade(tr) {
  if (typeof tr.netUsd === 'number' && Number.isFinite(tr.netUsd)) {
    state.realizedUsd += tr.netUsd;
    state.count += 1;
  }
}

function getTotals() {
  return { realizedUsd: Number(state.realizedUsd.toFixed(6)), count: state.count };
}

module.exports = { initFromTodayCsv, addTrade, getTotals };
