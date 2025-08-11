const { ethers } = require('ethers');
const cfg = require('./multichainConfig');

function provider(){ return new ethers.JsonRpcProvider(cfg.EVM_RPC_URL, cfg.EVM_CHAIN_ID); }

// Aerodrome contracts on Base
const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';

// Aerodrome Router ABI
const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
];

// Get quote from Aerodrome
async function quoteAerodrome(tokenIn, tokenOut, amountIn) {
  console.log(`[aerodrome] Getting quote: ${tokenIn} -> ${tokenOut}`);
  
  try {
    const router = new ethers.Contract(AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider());
    
    // Simple path: tokenIn -> tokenOut
    const path = [tokenIn, tokenOut];
    
    const amounts = await router.getAmountsOut(amountIn, path);
    const amountOut = amounts[amounts.length - 1];
    
    console.log(`[aerodrome] Quote: ${ethers.formatEther(amountIn)} -> ${Number(amountOut) / 1e6} USDC`);
    
    return {
      router: 'aerodrome',
      buyAmount: amountOut.toString(),
      sellToken: tokenIn,
      buyToken: tokenOut,
      sellAmount: amountIn.toString(),
      path: path
    };
    
  } catch (e) {
    console.log(`[aerodrome] Quote failed: ${e.message}`);
    throw e;
  }
}

// Execute trade on Aerodrome
async function execAerodrome(normQuote, pair, estNetUsd) {
  console.log(`[aerodrome] Executing trade for ${pair}`);
  
  try {
    const wallet = new ethers.Wallet(cfg.EVM_PRIVATE_KEY, provider());
    const router = new ethers.Contract(AERODROME_ROUTER, AERODROME_ROUTER_ABI, wallet);
    
    // Ensure WETH approval
    const ERC20_ABI = [
      'function approve(address spender, uint256 value) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)'
    ];
    
    const tokenContract = new ethers.Contract(normQuote.sellToken, ERC20_ABI, wallet);
    const owner = await wallet.getAddress();
    
    const currentAllowance = await tokenContract.allowance(owner, AERODROME_ROUTER);
    const requiredAmount = ethers.toBigInt(normQuote.sellAmount);
    
    if (currentAllowance < requiredAmount) {
      console.log(`[aerodrome] Approving ${ethers.formatEther(requiredAmount)} tokens...`);
      const approveTx = await tokenContract.approve(AERODROME_ROUTER, ethers.MaxUint256);
      await approveTx.wait();
      console.log(`[aerodrome] Approval successful`);
    }
    
    // Calculate minimum output with slippage
    const buyAmount = ethers.toBigInt(normQuote.buyAmount);
    const slippageBps = BigInt(process.env.SAFETY_SLIPPAGE_BPS || '500'); // 5% default
    const minOut = buyAmount - (buyAmount * slippageBps / 10000n);
    
    console.log(`[aerodrome] Expected: ${Number(buyAmount) / 1e6} USDC`);
    console.log(`[aerodrome] Min out: ${Number(minOut) / 1e6} USDC`);
    
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
    
    // Execute swap
    const tx = await router.swapExactTokensForTokens(
      ethers.toBigInt(normQuote.sellAmount),
      minOut,
      normQuote.path,
      owner,
      deadline,
      {
        gasLimit: 200000 // Conservative gas limit
      }
    );
    
    console.log(`[aerodrome] Transaction submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    
    console.log(`[aerodrome] Trade ${receipt.status === 1 ? 'successful' : 'failed'}`);
    console.log(`[aerodrome] Gas used: ${receipt.gasUsed.toString()}`);
    
    return {
      success: receipt.status === 1,
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString()
    };
    
  } catch (e) {
    console.log(`[aerodrome] Execution error: ${e.reason || e.message}`);
    return {
      success: false,
      txHash: '',
      error: e.reason || e.message
    };
  }
}

module.exports = {
  quoteAerodrome,
  execAerodrome
};