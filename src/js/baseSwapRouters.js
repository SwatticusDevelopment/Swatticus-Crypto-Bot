// src/js/baseSwapRouters.js — ROBUST BaseSwap with retry logic and approval handling
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
  'function balanceOf(address) view returns (uint256)',
  'function name() view returns (string)'
];

const V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function factory() external view returns (address)',
  'function WETH() external view returns (address)'
];

const MAX_UINT = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

// Enhanced token metadata with error handling
async function tokenMeta(addr, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const c = new ethers.Contract(addr, ERC20_ABI, provider());
      
      const [decimals, symbol, name] = await Promise.all([
        c.decimals().catch(() => 18),
        c.symbol().catch(() => `TOKEN_${addr.slice(-4)}`),
        c.name().catch(() => `Token ${addr.slice(-4)}`)
      ]);
      
      return { 
        decimals: Number(decimals), 
        symbol: String(symbol), 
        name: String(name),
        addr: ethers.getAddress(addr) 
      };
    } catch (e) {
      console.log(`[tokenMeta] Attempt ${attempt}/${retries} failed for ${addr}: ${e.message}`);
      if (attempt === retries) {
        // Return fallback metadata
        return {
          decimals: 18,
          symbol: `TOKEN_${addr.slice(-4)}`,
          name: `Unknown Token`,
          addr: ethers.getAddress(addr)
        };
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// Robust approval function with comprehensive retry logic
async function robustApproval(tokenContract, spenderAddress, requiredAmount, walletAddress, tokenSymbol = 'TOKEN') {
  const maxRetries = Number(process.env.APPROVAL_RETRY_COUNT || 3);
  const timeoutMs = Number(process.env.APPROVAL_TIMEOUT_MS || 60000);
  
  console.log(`[approval] 🔐 Starting robust approval for ${tokenSymbol}...`);
  
  try {
    // Step 1: Check current allowance
    const currentAllowance = await tokenContract.allowance(walletAddress, spenderAddress);
    console.log(`[approval] Current allowance: ${ethers.formatEther(currentAllowance)} ${tokenSymbol} (shown in ETH units)`);
    
    // Step 2: If sufficient allowance exists, skip approval
    if (currentAllowance >= requiredAmount) {
      console.log(`[approval] ✅ Sufficient allowance exists, skipping approval`);
      return { success: true, txHash: null, message: 'Sufficient allowance' };
    }
    
    console.log(`[approval] ⚠️  Insufficient ${tokenSymbol} allowance`);
    console.log(`[approval] Required: ${ethers.formatEther(requiredAmount)}`);
    console.log(`[approval] Current:  ${ethers.formatEther(currentAllowance)}`);
    
    // Step 3: Attempt approval with retries
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[approval] 🔄 Approval attempt ${attempt}/${maxRetries} for ${tokenSymbol}...`);
        
        // Conservative gas estimation
        let gasLimit;
        try {
          const gasEstimate = await tokenContract.approve.estimateGas(spenderAddress, MAX_UINT);
          gasLimit = gasEstimate + (gasEstimate * BigInt(process.env.GAS_BUFFER_PERCENT || 25) / 100n);
          console.log(`[approval] Gas estimate: ${gasEstimate}, using: ${gasLimit}`);
        } catch (gasError) {
          gasLimit = BigInt(150000); // Conservative fallback
          console.log(`[approval] Gas estimation failed, using fallback: ${gasLimit}`);
        }
        
        // Prepare transaction options
        const txOptions = {
          gasLimit: gasLimit
        };
        
        // Add gas price if specified
        if (process.env.FIXED_GAS_PRICE_WEI) {
          txOptions.gasPrice = BigInt(process.env.FIXED_GAS_PRICE_WEI);
          console.log(`[approval] Using fixed gas price: ${txOptions.gasPrice}`);
        }
        
        // Submit approval transaction
        const approveTx = await tokenContract.approve(spenderAddress, MAX_UINT, txOptions);
        console.log(`[approval] 📝 Approval transaction submitted: ${approveTx.hash}`);
        
        // Wait for confirmation with timeout
        const receipt = await Promise.race([
          approveTx.wait(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Approval timeout after ${timeoutMs}ms`)), timeoutMs)
          )
        ]);
        
        if (receipt.status === 1) {
          console.log(`[approval] ✅ Approval successful! Gas used: ${receipt.gasUsed}`);
          
          // Verify the approval worked
          if (process.env.VERIFY_APPROVALS === 'true') {
            console.log(`[approval] 🔍 Verifying approval...`);
            await new Promise(r => setTimeout(r, 2000)); // Wait for state update
            
            const newAllowance = await tokenContract.allowance(walletAddress, spenderAddress);
            if (newAllowance >= requiredAmount) {
              console.log(`[approval] ✅ Verification passed, allowance now: ${ethers.formatEther(newAllowance)}`);
              return { success: true, txHash: receipt.hash, gasUsed: receipt.gasUsed };
            } else {
              console.log(`[approval] ⚠️  Verification failed, allowance: ${ethers.formatEther(newAllowance)}`);
              if (attempt < maxRetries) continue;
              return { success: false, error: 'Approval verification failed' };
            }
          } else {
            return { success: true, txHash: receipt.hash, gasUsed: receipt.gasUsed };
          }
        } else {
          throw new Error(`Approval transaction failed with status: ${receipt.status}`);
        }
        
      } catch (attemptError) {
        console.log(`[approval] ❌ Attempt ${attempt} failed: ${attemptError.message}`);
        
        // Check for specific error types
        if (attemptError.message.includes('insufficient funds')) {
          return { success: false, error: 'Insufficient ETH for gas fees' };
        }
        
        if (attemptError.message.includes('nonce')) {
          console.log(`[approval] 🔄 Nonce error, waiting before retry...`);
          await new Promise(r => setTimeout(r, 5000));
        }
        
        // If this isn't the last attempt, wait before retrying
        if (attempt < maxRetries) {
          const waitTime = attempt * 2000; // Exponential backoff: 2s, 4s, 6s
          console.log(`[approval] ⏳ Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    return { success: false, error: `All ${maxRetries} approval attempts failed` };
    
  } catch (error) {
    console.log(`[approval] ❌ Critical approval error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Original quote function (enhanced with retries)
async function quoteBaseSwap(sellToken, buyToken, sellAmountWei, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const router = new ethers.Contract(BASESWAP_ROUTER, V2_ROUTER_ABI, provider());

      const [sell, buy] = await Promise.all([
        tokenMeta(sellToken),
        tokenMeta(buyToken)
      ]);

      const amountIn = typeof sellAmountWei === 'bigint'
        ? sellAmountWei
        : (typeof sellAmountWei === 'string' ? BigInt(sellAmountWei) : BigInt(sellAmountWei));

      const path = [sell.addr, buy.addr];
      
      // Add retry logic for getAmountsOut
      let amounts;
      for (let quoteAttempt = 1; quoteAttempt <= 3; quoteAttempt++) {
        try {
          amounts = await router.getAmountsOut(amountIn, path);
          break;
        } catch (quoteError) {
          if (quoteAttempt === 3) throw quoteError;
          console.log(`[quote] Attempt ${quoteAttempt}/3 failed, retrying...`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      
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
        path,
        sellSymbol: sell.symbol,
        buySymbol: buy.symbol,
        sellDecimals: sell.decimals,
        buyDecimals: buy.decimals
      };
      
    } catch (error) {
      console.log(`[quote] Attempt ${attempt}/${retries} failed: ${error.message}`);
      if (attempt === retries) {
        throw error;
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// Robust execution function
async function execBaseSwap(normQuote, pairLabel, estNetUsd) {
  const maxSwapRetries = Number(process.env.EXECUTION_RETRY_COUNT || 2);
  const swapTimeoutMs = Number(process.env.SWAP_TIMEOUT_MS || 120000);
  
  console.log(`[baseswap] 🚀 Starting robust execution for ${pairLabel}`);
  console.log(`[baseswap] Estimated profit: $${estNetUsd}`);
  
  try {
    const signer = wallet();
    const router = new ethers.Contract(BASESWAP_ROUTER, V2_ROUTER_ABI, signer);

    const sellAddr = ethers.getAddress(normQuote.sellToken);
    const buyAddr  = ethers.getAddress(normQuote.buyToken);
    const amountIn = BigInt(normQuote.sellAmount);
    const expOut   = BigInt(normQuote.buyAmount);

    // Get initial slippage
    let slippageBps = parseInt(process.env.DEFAULT_SLIPPAGE_BPS || '250', 10);
    let minOut = expOut * BigInt(10_000 - slippageBps) / BigInt(10_000);

    const path = [sellAddr, buyAddr];
    const from = await signer.getAddress();

    console.log(`[baseswap] 📊 Trade details:`);
    console.log(`  Wallet: ${from}`);
    console.log(`  Sell: ${sellAddr} (${normQuote.sellSymbol || 'TOKEN'})`);
    console.log(`  Buy: ${buyAddr} (${normQuote.buySymbol || 'TOKEN'})`);
    console.log(`  Amount In: ${amountIn.toString()} wei`);
    console.log(`  Expected Out: ${expOut.toString()} wei`);
    console.log(`  Min Out (${slippageBps/100}% slippage): ${minOut.toString()} wei`);

    // Step 1: Check balance
    const sellToken = new ethers.Contract(sellAddr, ERC20_ABI, signer);
    const balance = await sellToken.balanceOf(from);

    if (balance < amountIn) {
      console.log(`[baseswap] ❌ Insufficient balance: ${balance} < ${amountIn}`);
      return { success: false, txHash: '', error: 'Insufficient token balance' };
    }

    console.log(`[baseswap] ✅ Balance check passed: ${balance} >= ${amountIn}`);

    // Step 2: Handle approval
    const tokenSymbol = normQuote.sellSymbol || 'TOKEN';
    const approvalResult = await robustApproval(sellToken, BASESWAP_ROUTER, amountIn, from, tokenSymbol);

    if (!approvalResult.success) {
      console.log(`[baseswap] ❌ Approval failed: ${approvalResult.error}`);
      return { success: false, txHash: '', error: `Approval failed: ${approvalResult.error}` };
    }

    if (approvalResult.txHash) {
      console.log(`[baseswap] ✅ Approval completed: ${approvalResult.txHash}`);
    }

    // Step 3: Execute swap with retries
    for (let swapAttempt = 1; swapAttempt <= maxSwapRetries; swapAttempt++) {
      try {
        console.log(`[baseswap] 🔄 Swap attempt ${swapAttempt}/${maxSwapRetries}...`);

        const deadline = Math.floor(Date.now() / 1000) + parseInt(process.env.TX_DEADLINE_SEC || '300', 10);

        // Get gas estimate
        let gasLimit;
        try {
          const gasEstimate = await router.swapExactTokensForTokens.estimateGas(
            amountIn, minOut, path, from, BigInt(deadline)
          );
          gasLimit = gasEstimate + (gasEstimate * BigInt(process.env.GAS_BUFFER_PERCENT || 25) / 100n);
          console.log(`[baseswap] Gas estimate: ${gasEstimate}, using: ${gasLimit}`);
        } catch (gasError) {
          gasLimit = BigInt(process.env.GAS_ESTIMATE_UNIV2 || '300000');
          console.log(`[baseswap] Gas estimation failed, using fallback: ${gasLimit}`);
        }

        // Prepare transaction options
        const txOptions = { gasLimit };
        if (process.env.FIXED_GAS_PRICE_WEI) {
          txOptions.gasPrice = BigInt(process.env.FIXED_GAS_PRICE_WEI);
        }

        console.log(`[baseswap] 🔄 Executing swap with ${slippageBps/100}% slippage...`);

        // Execute swap
        const swapTx = await router.swapExactTokensForTokens(
          amountIn,
          minOut,
          path,
          from,
          BigInt(deadline),
          txOptions
        );

        console.log(`[baseswap] 📝 Swap transaction submitted: ${swapTx.hash}`);

        // Wait for confirmation with timeout
        const receipt = await Promise.race([
          swapTx.wait(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Swap timeout after ${swapTimeoutMs}ms`)), swapTimeoutMs)
          )
        ]);

        if (receipt.status === 1) {
          console.log(`[baseswap] 🎉 SWAP SUCCESSFUL!`);
          console.log(`[baseswap] Gas used: ${receipt.gasUsed}`);
          console.log(`[baseswap] Final profit: $${estNetUsd}`);
          
          return { 
            success: true, 
            txHash: receipt.hash, 
            gasUsed: receipt.gasUsed.toString(),
            sellAmount: amountIn.toString(), 
            buyAmount: expOut.toString(),
            approvalTx: approvalResult.txHash
          };
        } else {
          throw new Error(`Swap transaction failed with status: ${receipt.status}`);
        }

      } catch (swapError) {
        console.log(`[baseswap] ❌ Swap attempt ${swapAttempt} failed: ${swapError.message}`);

        // On first failure, try with higher slippage if enabled
        if (swapAttempt === 1 && process.env.DYNAMIC_SLIPPAGE === 'true') {
          const maxSlippage = Number(process.env.MAX_SLIPPAGE_BPS || 500);
          const newSlippage = Math.min(slippageBps + 100, maxSlippage); // Add 1%
          
          if (newSlippage > slippageBps) {
            slippageBps = newSlippage;
            minOut = expOut * BigInt(10_000 - slippageBps) / BigInt(10_000);
            console.log(`[baseswap] 🔄 Retrying with higher slippage: ${slippageBps/100}%`);
            console.log(`[baseswap] New min out: ${minOut.toString()} wei`);
          }
        }

        // If this is the last attempt, return failure
        if (swapAttempt === maxSwapRetries) {
          console.log(`[baseswap] ❌ All swap attempts failed`);
          return { 
            success: false, 
            txHash: '', 
            error: swapError.shortMessage || swapError.reason || swapError.message,
            approvalTx: approvalResult.txHash
          };
        }
        
        // Wait before retry
        await new Promise(r => setTimeout(r, 2000));
      }
    }

  } catch (error) {
    console.log(`[baseswap] ❌ Critical execution error: ${error.message}`);
    return { 
      success: false, 
      txHash: '', 
      error: error.shortMessage || error.reason || error.message 
    };
  }
}

module.exports = { 
  quoteBaseSwap, 
  execBaseSwap,
  robustApproval 
};