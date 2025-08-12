// test-baseswap-complete.js - Test complete BaseSwap integration
require('dotenv').config();
const { ethers } = require('ethers');

async function testBaseSwapComplete() {
  console.log('🚀 Testing complete BaseSwap integration...\n');
  
  const provider = new ethers.JsonRpcProvider(
    process.env.EVM_RPC_URL,
    parseInt(process.env.EVM_CHAIN_ID || '8453', 10)
  );
  
  const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);
  const address = await wallet.getAddress();
  
  const WETH = '0x4200000000000000000000000000000000000006';
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const BASESWAP_ROUTER = '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86';
  
  // Import your BaseSwap functions
  const { quoteBaseSwap, execBaseSwap } = require('../src/js/baseSwapRouters');
  
  const amountIn = ethers.parseEther('0.0001'); // Small test amount
  
  console.log('📊 Step 1: Getting quote...');
  console.log(`Amount in: ${ethers.formatEther(amountIn)} WETH`);
  
  try {
    // Test quote
    const quote = await quoteBaseSwap(WETH, USDC, amountIn);
    
    console.log('✅ Quote successful!');
    console.log(`Expected out: ${Number(quote.buyAmount) / 1e6} USDC`);
    
    // Step 2: Check and approve if needed
    console.log('\n🔐 Step 2: Checking WETH approval...');
    
    const ERC20_ABI = [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 value) returns (bool)',
      'function balanceOf(address owner) view returns (uint256)'
    ];
    
    const wethContract = new ethers.Contract(WETH, ERC20_ABI, wallet);
    const usdcContract = new ethers.Contract(USDC, ERC20_ABI, provider);
    
    const [currentAllowance, wethBalance, usdcBalanceBefore] = await Promise.all([
      wethContract.allowance(address, BASESWAP_ROUTER),
      wethContract.balanceOf(address),
      usdcContract.balanceOf(address)
    ]);
    
    console.log(`WETH Balance: ${ethers.formatEther(wethBalance)}`);
    console.log(`USDC Balance (before): ${Number(usdcBalanceBefore) / 1e6}`);
    console.log(`Current Allowance: ${ethers.formatEther(currentAllowance)}`);
    
    if (currentAllowance < amountIn) {
      console.log('⚠️  Need to approve WETH...');
      
      const approveTx = await wethContract.approve(BASESWAP_ROUTER, ethers.MaxUint256);
      console.log(`Approval tx: ${approveTx.hash}`);
      
      const approveReceipt = await approveTx.wait();
      console.log(`Approval ${approveReceipt.status === 1 ? 'successful' : 'failed'}`);
      
      if (approveReceipt.status !== 1) {
        throw new Error('Approval failed');
      }
    } else {
      console.log('✅ Sufficient allowance exists');
    }
    
    // Step 3: Execute trade
    console.log('\n🚀 Step 3: Executing trade...');
    
    const normQuote = {
      sellToken: WETH,
      buyToken: USDC,
      sellAmount: amountIn.toString(),
      buyAmount: quote.buyAmount,
      path: quote.path
    };
    
    const result = await execBaseSwap(normQuote, 'WETH/USDC', 0.5);
    
    if (result.success) {
      console.log('🎉 TRADE SUCCESSFUL!');
      console.log(`Transaction: ${result.txHash}`);
      console.log(`Gas used: ${result.gasUsed}`);
      
      // Check final balances
      const [wethBalanceAfter, usdcBalanceAfter] = await Promise.all([
        wethContract.balanceOf(address),
        usdcContract.balanceOf(address)
      ]);
      
      console.log('\n📊 Final Balances:');
      console.log(`WETH: ${ethers.formatEther(wethBalanceAfter)} (was ${ethers.formatEther(wethBalance)})`);
      console.log(`USDC: ${Number(usdcBalanceAfter) / 1e6} (was ${Number(usdcBalanceBefore) / 1e6})`);
      
      const wethUsed = Number(ethers.formatEther(wethBalance)) - Number(ethers.formatEther(wethBalanceAfter));
      const usdcGained = (Number(usdcBalanceAfter) - Number(usdcBalanceBefore)) / 1e6;
      
      console.log(`\n✅ Trade Summary:`);
      console.log(`   Sold: ${wethUsed.toFixed(6)} WETH`);
      console.log(`   Received: ${usdcGained.toFixed(6)} USDC`);
      console.log(`   Rate: ${(usdcGained / wethUsed).toFixed(2)} USDC per WETH`);
      
      console.log('\n🎯 SUCCESS! BaseSwap integration is working!');
      console.log('Your bot can now execute real trades on BaseSwap.');
      
    } else {
      console.log('❌ Trade failed:', result.error);
    }
    
  } catch (e) {
    console.log('❌ Test failed:', e.message);
  }
}

testBaseSwapComplete().catch(console.error);