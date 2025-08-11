require('dotenv').config();
const { ethers } = require('ethers');

async function testAerodrome() {
  console.log('🚁 Testing Aerodrome DEX on Base...\n');
  
  const provider = new ethers.JsonRpcProvider(
    process.env.EVM_RPC_URL,
    parseInt(process.env.EVM_CHAIN_ID || '8453', 10)
  );
  
  const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);  // FIXED: removed ()
  
  const WETH = '0x4200000000000000000000000000000000000006';
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';
  
  console.log('📋 Checking Aerodrome contracts...');
  
  // Check if Aerodrome router exists
  const routerCode = await provider.getCode(AERODROME_ROUTER);
  if (routerCode === '0x') {
    console.log('❌ Aerodrome router not found!');
    return;
  }
  console.log('✅ Aerodrome router exists');
  
  // Test quote
  const ROUTER_ABI = [
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
  ];
  
  const router = new ethers.Contract(AERODROME_ROUTER, ROUTER_ABI, provider);
  const amountIn = ethers.parseEther('0.0001');
  const path = [WETH, USDC];
  
  console.log('\n💰 Testing quote...');
  console.log('Amount in:', ethers.formatEther(amountIn), 'WETH');
  
  try {
    const amounts = await router.getAmountsOut(amountIn, path);
    const amountOut = amounts[amounts.length - 1];
    
    console.log('✅ Quote successful!');
    console.log('Expected out:', Number(amountOut) / 1e6, 'USDC');
    console.log('Rate:', (Number(amountOut) / 1e6) / 0.0001, 'USDC per WETH');
    
    // Compare with our current price calculation
    const currentEthPrice = 4180; // Approximate
    const expectedRate = currentEthPrice;
    const aerodromeRate = (Number(amountOut) / 1e6) / 0.0001;
    
    console.log('Expected rate:', expectedRate, 'USDC per WETH');
    console.log('Aerodrome rate:', aerodromeRate.toFixed(2), 'USDC per WETH');
    
    const priceDiff = Math.abs(aerodromeRate - expectedRate) / expectedRate * 100;
    console.log('Price difference:', priceDiff.toFixed(2), '%');
    
    if (priceDiff < 5) {
      console.log('✅ Price looks reasonable!');
    } else {
      console.log('⚠️  Large price difference - check liquidity');
    }
    
    // Test execution (small amount)
    console.log('\n🚀 Testing trade execution...');
    
    const EXEC_ROUTER_ABI = [
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
    ];
    
    const execRouter = new ethers.Contract(AERODROME_ROUTER, EXEC_ROUTER_ABI, wallet);
    
    // Check allowance first
    const ERC20_ABI = [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 value) returns (bool)'
    ];
    
    const wethContract = new ethers.Contract(WETH, ERC20_ABI, wallet);
    const owner = await wallet.getAddress();
    
    const currentAllowance = await wethContract.allowance(owner, AERODROME_ROUTER);
    console.log('Current allowance:', ethers.formatEther(currentAllowance), 'WETH');
    
    if (currentAllowance < amountIn) {
      console.log('🔐 Approving WETH for Aerodrome...');
      const approveTx = await wethContract.approve(AERODROME_ROUTER, ethers.MaxUint256);
      await approveTx.wait();
      console.log('✅ Approval successful');
    }
    
    // Execute trade with 10% slippage
    const minOut = (amountOut * 90n) / 100n;
    const deadline = Math.floor(Date.now() / 1000) + 600;
    
    console.log('Min out (10% slippage):', Number(minOut) / 1e6, 'USDC');
    
    // Estimate gas first
    try {
      const gasEstimate = await execRouter.swapExactTokensForTokens.estimateGas(
        amountIn,
        minOut,
        path,
        owner,
        deadline
      );
      
      console.log('✅ Gas estimation successful:', gasEstimate.toString());
      
      // Execute the trade
      const tx = await execRouter.swapExactTokensForTokens(
        amountIn,
        minOut,
        path,
        owner,
        deadline,
        {
          gasLimit: gasEstimate + (gasEstimate / 10n)
        }
      );
      
      console.log('Transaction hash:', tx.hash);
      console.log('⏳ Waiting for confirmation...');
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        console.log('🎉 AERODROME TRADE SUCCESSFUL!');
        console.log('Gas used:', receipt.gasUsed.toString());
        
        // Check final balances
        const usdcContract = new ethers.Contract(USDC, ERC20_ABI, provider);
        const finalUsdcBalance = await usdcContract.balanceOf(owner);
        
        console.log('Final USDC balance:', Number(finalUsdcBalance) / 1e6);
        console.log('\n🎯 SUCCESS! Your bot should use Aerodrome DEX!');
        
      } else {
        console.log('❌ Transaction failed');
      }
      
    } catch (gasError) {
      console.log('❌ Gas estimation failed:', gasError.reason || gasError.message);
    }
    
  } catch (e) {
    console.log('❌ Quote failed:', e.message);
  }
}

testAerodrome().catch(console.error);