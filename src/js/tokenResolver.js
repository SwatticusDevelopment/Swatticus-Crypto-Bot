// tokenResolver.js
const { ethers } = require('ethers');
let TOKENS = {}; try { TOKENS = JSON.parse(process.env.TOKENS_JSON || '{}'); } catch { TOKENS = {}; }
function resolveToken(input) { if (!input) throw new Error('token missing'); const t = String(input).trim(); if (ethers.isAddress(t)) return ethers.getAddress(t); const sym = t.toUpperCase(); const addr = TOKENS[sym]; if (addr && ethers.isAddress(addr)) return ethers.getAddress(addr); throw new Error(`unknown token symbol: ${t} (add it to TOKENS_JSON)`); }
module.exports = { resolveToken };