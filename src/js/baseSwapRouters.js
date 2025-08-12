// src/js/baseSwapRouters.js — BaseSwap (Uniswap V2) quote + execute (ethers v6)
const { ethers } = require('ethers');
const cfg = require('./multichainConfig');

function provider() { return new ethers.JsonRpcProvider(cfg.EVM_RPC_URL, cfg.EVM_CHAIN_ID); }
function wallet()   { return new ethers.Wallet(cfg.EVM_PRIVATE_KEY, provider()); }

const BASESWAP_ROUTER = (process.env.BASESWAP_ROUTER || '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86');
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)'
];

const V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function factory() external view returns (address)',
  'function WETH() external view returns (address)'
];

const MAX_UINT = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

async function tokenMeta(addr) {
  const c = new ethers.Contract(addr, ERC20_ABI, provider());
  let decimals = 18, symbol = 'UNK';
  try { decimals = Number(await c.decimals()); } catch {}
  try { symbol   = await c.symbol(); } catch {}
  return { decimals, symbol, addr: ethers.getAddress(addr) };
}

async function quoteBaseSwap(sellToken, buyToken, sellAmountWei) {
  const router = new ethers.Contract(BASESWAP_ROUTER, V2_ROUTER_ABI, provider());

  const sell = await tokenMeta(sellToken);
  const buy  = await tokenMeta(buyToken);

  const amountIn = typeof sellAmountWei === 'bigint'
    ? sellAmountWei
    : (typeof sellAmountWei === 'string' ? BigInt(sellAmountWei) : BigInt(sellAmountWei));

  const path = [sell.addr, buy.addr];
  const amounts = await router.getAmountsOut(amountIn, path);
  const amountOut = BigInt(amounts[amounts.length - 1]);

  const humanIn  = ethers.formatUnits(amountIn,  sell.decimals);
  const humanOut = ethers.formatUnits(amountOut, buy.decimals);

  console.log(`[baseswap] Quote successful: ${humanOut} ${buy.symbol}`);
  console.log(`[baseswap] Rate: ${(Number(humanOut)/Number(humanIn)).toFixed(8)} ${buy.symbol} per ${sell.symbol}`);

  return {
    router: 'baseswap',
    sellToken: sell.addr,
    buyToken: buy.addr,
    sellAmount: amountIn.toString(),
    buyAmount: amountOut.toString(),
    path
  };
}

async function execBaseSwap(normQuote, pairLabel, estNetUsd) {
  const signer = wallet();
  const router = new ethers.Contract(BASESWAP_ROUTER, V2_ROUTER_ABI, signer);

  const sellAddr = ethers.getAddress(normQuote.sellToken);
  const buyAddr  = ethers.getAddress(normQuote.buyToken);
  const amountIn = BigInt(normQuote.sellAmount);
  const expOut   = BigInt(normQuote.buyAmount);

  const slippageBps = parseInt(process.env.DEFAULT_SLIPPAGE_BPS || '500', 10); // 5%
  const minOut = expOut * BigInt(10_000 - slippageBps) / BigInt(10_000);

const path = Array.isArray(normQuote.path) && normQuote.path.length >= 2
  ? normQuote.path.map(ethers.getAddress)
  : [sellAddr, buyAddr];

  const sell = new ethers.Contract(sellAddr, ERC20_ABI, signer);
  const from = await signer.getAddress();
  const allowance = BigInt(await sell.allowance(from, BASESWAP_ROUTER));
  console.log(`[baseswap] Current allowance: ${ethers.formatUnits(allowance, 18)} (raw wei shown in 18d for readability)`);

  if (allowance < amountIn) {
    console.log('[baseswap] Approving unlimited allowance...');
    const txA = await sell.approve(BASESWAP_ROUTER, MAX_UINT);
    await txA.wait();
  }

  const deadlineSecs = Math.floor(Date.now() / 1000) + (parseInt(process.env.TX_DEADLINE_SEC || '300', 10));
  const overrides = {};
  if (process.env.FIXED_GAS_PRICE_WEI) {
    overrides.gasPrice = BigInt(process.env.FIXED_GAS_PRICE_WEI);
  }
  if (process.env.GAS_LIMIT_SWAP) {
    overrides.gasLimit = BigInt(process.env.GAS_LIMIT_SWAP);
  }

  console.log(`[baseswap] Expected out: ${expOut.toString()} wei`);
  console.log(`[baseswap] Min out (${slippageBps/100}% slippage): ${minOut.toString()} wei`);
  console.log('[baseswap] Executing swapExactTokensForTokens...');

  try {
    const tx = await router.swapExactTokensForTokens(
      amountIn,
      minOut,
      path,
      from,
      BigInt(deadlineSecs),
      overrides
    );
    console.log('[baseswap] Sent:', tx.hash);
    const rec = await tx.wait();

    if (rec.status !== 1) {
      return { success: false, txHash: tx.hash, error: `receipt status ${rec.status}` };
    }
    return { success: true, txHash: tx.hash, sellAmount: amountIn.toString(), buyAmount: expOut.toString() };
  } catch (e) {
    console.log(`[baseswap] Execution error: ${e.shortMessage || e.reason || e.message}`);
    return { success: false, txHash: '', error: e.shortMessage || e.reason || e.message };
  }
}

module.exports = { quoteBaseSwap, execBaseSwap };
