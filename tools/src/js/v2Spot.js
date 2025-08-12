// src/js/v2Spot.js — Uniswap V2-style spot quotes (BaseSwap)
const { ethers } = require('ethers');

const CHAIN_ID = Number(process.env.EVM_CHAIN_ID || 8453);
const RPC_URL  = process.env.EVM_RPC_URL;
const FACTORY  = (process.env.BASESWAP_FACTORY || '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB');
const FEE_BPS  = Number(process.env.V2_FEE_BPS || 30); // 0.30% default

const V2_FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const V2_PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112,uint112,uint32)'
];

function getProvider() {
  if (!RPC_URL) throw new Error('EVM_RPC_URL missing');
  return new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
}
const addr = (a)=>ethers.getAddress(a);

async function getPairAddress(tokenA, tokenB) {
  const pvd = getProvider();
  const f = new ethers.Contract(FACTORY, V2_FACTORY_ABI, pvd);
  const pa = await f.getPair(addr(tokenA), addr(tokenB));
  return pa === ethers.ZeroAddress ? null : pa;
}

async function getReserves(tokenA, tokenB) {
  const pairAddr = await getPairAddress(tokenA, tokenB);
  if (!pairAddr) return null;
  const pvd = getProvider();
  const pair = new ethers.Contract(pairAddr, V2_PAIR_ABI, pvd);
  const t0 = await pair.token0();
  const t1 = await pair.token1();
  const [r0, r1] = await pair.getReserves();
  return { pair: pairAddr, token0: t0, token1: t1, reserve0: BigInt(r0), reserve1: BigInt(r1) };
}

// amountOut = amountIn*(1-fee) * R_out / (R_in + amountIn*(1-fee))
function _amountOutV2(amountInRaw, reserveIn, reserveOut) {
  const amountIn = BigInt(amountInRaw);
  const feeKeep = BigInt(10_000 - FEE_BPS);
  const amountInWithFee = amountIn * feeKeep;
  const numerator = amountInWithFee * reserveOut;
  const denominator = (reserveIn * 10_000n) + amountInWithFee;
  if (denominator === 0n) return 0n;
  return numerator / denominator;
}

async function spotAmountOutV2(tokenIn, tokenOut, amountInRaw) {
  const rs = await getReserves(tokenIn, tokenOut);
  if (!rs) throw new Error('No V2 pair');
  const xIn = addr(tokenIn).toLowerCase() === rs.token0.toLowerCase();
  const reserveIn  = xIn ? rs.reserve0 : rs.reserve1;
  const reserveOut = xIn ? rs.reserve1 : rs.reserve0;
  if (reserveIn === 0n || reserveOut === 0n) throw new Error('Empty reserves');
  return _amountOutV2(amountInRaw, reserveIn, reserveOut).toString();
}

module.exports = { spotAmountOutV2, getReserves, getPairAddress };
