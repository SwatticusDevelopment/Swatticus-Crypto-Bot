// wallet-diagnosis.js - Comprehensive wallet and token analysis
require('dotenv').config();
const { ethers } = require('ethers');

async function diagnoseWallet() {
  console.log('🔍 WALLET & TOKEN DIAGNOSIS');
  console.log('============================\n');
  
  const provider = new ethers.JsonRpcProvider(
    process.env.EVM_RPC_URL,
    parseInt(process.env.EVM_CHAIN_ID || '8453', 10)
  );
  
  const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);
  const address = await wallet.getAddress();
  
  console.log('📋 BASIC INFO:');
  console.log(`Wallet Address: ${address}`);
  console.log(`Chain ID: ${await provider.getNetwork().then(n => n.chainId)}`);
  console.log(`Block Number: ${await provider.getBlockNumber()}\n`);
  
  // Token addresses from your failed transaction
  const TOKENS = {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    USDT: '0xeb466342c4d449bc9f53a865d5cb90586f405215', // The failing token
    USDbC: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca'
  };
  
  const ROUTERS = {
    BaseSwap: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86'
  };
  
  const ERC20_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function totalSupply() view returns (uint256)'
  ];
  
  // Check ETH balance
  console.log('💰 ETH BALANCE:');
  const ethBalance = await provider.getBalance(address);
  console.log(`ETH: ${ethers.formatEther(ethBalance)} ETH\n`);
  
  if (ethBalance < ethers.parseEther('0.001')) {
    console.log('⚠️  WARNING: Low ETH balance for gas fees!\n');
  }
  
  // Check all token balances and allowances
  console.log('🪙 TOKEN BALANCES & ALLOWANCES:');
  console.log('=====================================');
  
  for (const [name, tokenAddr] of Object.entries(TOKENS)) {
    try {
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
      
      const [symbol, decimals, balance, totalSupply] = await Promise.all([
        token.symbol().catch(() => name),
        token.decimals().catch(() => 18),
        token.balanceOf(address),
        token.totalSupply().catch(() => 0n)
      ]);
      
      const balanceFormatted = ethers.formatUnits(balance, decimals);
      
      console.log(`\n📊 ${name} (${symbol}):`);
      console.log(`   Address: ${tokenAddr}`);
      console.log(`   Balance: ${balanceFormatted} ${symbol}`);
      console.log(`   Decimals: ${decimals}`);
      
      if (balance === 0n) {
        console.log(`   ❌ ZERO BALANCE - Cannot trade this token!`);
      } else {
        console.log(`   ✅ Has balance`);
      }
      
      // Check allowances for each router
      for (const [routerName, routerAddr] of Object.entries(ROUTERS)) {
        try {
          const allowance = await token.allowance(address, routerAddr);
          const allowanceFormatted = ethers.formatUnits(allowance, decimals);
          
          console.log(`   ${routerName} Allowance: ${allowanceFormatted} ${symbol}`);
          
          if (allowance === 0n && balance > 0n) {
            console.log(`   ⚠️  Need approval for ${routerName}`);
          }
        } catch (e) {
          console.log(`   ❌ Error checking ${routerName} allowance: ${e.message}`);
        }
      }
      
    } catch (e) {
      console.log(`\n❌ ${name}: Error reading token data: ${e.message}`);
    }
  }
  
  // Analyze the specific failing transaction
  console.log('\n🔍 TRANSACTION ANALYSIS:');
  console.log('========================');
  console.log('Your bot tried to trade:');
  console.log('USDT -> WETH via BaseSwap');
  console.log('Amount: ~25 USD worth');
  console.log('Expected profit: $23.73\n');
  
  // Check USDT specifically
  const usdtToken = new ethers.Contract(TOKENS.USDT, ERC20_ABI, provider);
  const usdtBalance = await usdtToken.balanceOf(address);
  const usdtAllowance = await usdtToken.allowance(address, ROUTERS.BaseSwap);
  
  console.log('🔍 USDT SPECIFIC CHECK:');
  console.log(`Balance: ${ethers.formatUnits(usdtBalance, 6)} USDT`);
  console.log(`BaseSwap Allowance: ${ethers.formatUnits(usdtAllowance, 6)} USDT`);
  
  // Calculate the trade amount your bot was trying to make
  const baseTradeUsd = parseFloat(process.env.BASE_TRADE_USD || '25');
  const requiredUsdt = baseTradeUsd; // Roughly 1:1 for stablecoins
  
  console.log(`\nRequired for trade: ~${requiredUsdt} USDT`);
  console.log(`Available: ${ethers.formatUnits(usdtBalance, 6)} USDT`);
  
  if (usdtBalance < ethers.parseUnits(requiredUsdt.toString(), 6)) {
    console.log('❌ INSUFFICIENT USDT BALANCE FOR TRADE!');
  } else {
    console.log('✅ Sufficient USDT balance');
  }
  
  // Test BaseSwap router
  console.log('\n🧪 BASESWAP ROUTER TEST:');
  console.log('=======================');
  
  const ROUTER_ABI = [
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
    'function factory() external view returns (address)',
    'function WETH() external view returns (address)'
  ];
  
  try {
    const router = new ethers.Contract(ROUTERS.BaseSwap, ROUTER_ABI, provider);
    
    const factory = await router.factory();
    const weth = await router.WETH();
    
    console.log(`✅ Router accessible`);
    console.log(`   Factory: ${factory}`);
    console.log(`   WETH: ${weth}`);
    
    // Test a small quote
    if (usdtBalance > 0n) {
      const testAmount = ethers.parseUnits('1', 6); // 1 USDT
      const path = [TOKENS.USDT, TOKENS.WETH];
      
      try {
        const amounts = await router.getAmountsOut(testAmount, path);
        console.log(`✅ Quote test successful: 1 USDT = ${ethers.formatEther(amounts[1])} WETH`);
      } catch (e) {
        console.log(`❌ Quote test failed: ${e.message}`);
      }
    }
    
  } catch (e) {
    console.log(`❌ Router test failed: ${e.message}`);
  }
  
  // Recommendations
  console.log('\n🎯 DIAGNOSIS & RECOMMENDATIONS:');
  console.log('===============================');
  
  const issues = [];
  const fixes = [];
  
  if (ethBalance < ethers.parseEther('0.001')) {
    issues.push('Low ETH balance for gas');
    fixes.push('Add more ETH to wallet for gas fees');
  }
  
  if (usdtBalance === 0n) {
    issues.push('No USDT balance');
    fixes.push('Add USDT to wallet or exclude USDT from trading pairs');
  }
  
  if (usdtBalance > 0n && usdtAllowance === 0n) {
    issues.push('USDT not approved for BaseSwap');
    fixes.push('Approve USDT for BaseSwap router');
  }
  
  if (issues.length === 0) {
    console.log('✅ No obvious issues found!');
    console.log('The failure might be due to:');
    console.log('- Slippage too low');
    console.log('- Pool liquidity changed between quote and execution');
    console.log('- Gas limit too low');
  } else {
    console.log('❌ Issues found:');
    issues.forEach((issue, i) => {
      console.log(`   ${i + 1}. ${issue}`);
    });
    
    console.log('\n🔧 Fixes needed:');
    fixes.forEach((fix, i) => {
      console.log(`   ${i + 1}. ${fix}`);
    });
  }
  
  console.log('\n🚀 IMMEDIATE ACTIONS:');
  console.log('====================');
  console.log('1. Run the approval script below');
  console.log('2. Increase slippage to 2-3% in .env');
  console.log('3. Consider smaller trade sizes initially');
  console.log('4. Monitor gas prices during execution');
}

// Run diagnosis
diagnoseWallet().catch(console.error);