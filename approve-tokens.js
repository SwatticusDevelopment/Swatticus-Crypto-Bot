// approve-tokens.js - Fix token approvals for all trading pairs
require('dotenv').config();
const { ethers } = require('ethers');

async function approveAllTokens() {
  console.log('🔐 TOKEN APPROVAL SCRIPT');
  console.log('========================\n');
  
  const provider = new ethers.JsonRpcProvider(
    process.env.EVM_RPC_URL,
    parseInt(process.env.EVM_CHAIN_ID || '8453', 10)
  );
  
  const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);
  const address = await wallet.getAddress();
  
  console.log(`Wallet: ${address}`);
  console.log(`Network: Base (${await provider.getNetwork().then(n => n.chainId)})\n`);
  
  // All tokens your bot might trade
  const TOKENS = {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    USDT: '0xeb466342c4d449bc9f53a865d5cb90586f405215',
    USDbC: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca'
  };
  
  // All routers your bot might use
  const ROUTERS = {
    BaseSwap: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86'
  };
  
  const ERC20_ABI = [
    'function symbol() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 value) returns (bool)',
    'function decimals() view returns (uint8)'
  ];
  
  // Check ETH balance for gas
  const ethBalance = await provider.getBalance(address);
  console.log(`ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);
  
  if (ethBalance < ethers.parseEther('0.01')) {
    console.log('⚠️  WARNING: Low ETH balance. You may need more ETH for gas fees.\n');
  }
  
  let totalTxs = 0;
  let successfulTxs = 0;
  
  // Approve each token for each router
  for (const [tokenName, tokenAddr] of Object.entries(TOKENS)) {
    console.log(`\n🪙 Processing ${tokenName}...`);
    
    try {
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, wallet);
      const [symbol, decimals, balance] = await Promise.all([
        token.symbol().catch(() => tokenName),
        token.decimals().catch(() => 18),
        token.balanceOf(address)
      ]);
      
      console.log(`   Symbol: ${symbol}`);
      console.log(`   Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);
      
      if (balance === 0n) {
        console.log(`   ⏭️  Skipping (zero balance)`);
        continue;
      }
      
      for (const [routerName, routerAddr] of Object.entries(ROUTERS)) {
        try {
          console.log(`\n   🔍 Checking ${routerName} approval...`);
          
          const currentAllowance = await token.allowance(address, routerAddr);
          console.log(`      Current allowance: ${ethers.formatUnits(currentAllowance, decimals)} ${symbol}`);
          
          // If allowance is less than balance, approve max
          if (currentAllowance < balance) {
            console.log(`      📝 Approving unlimited ${symbol} for ${routerName}...`);
            
            const approveTx = await token.approve(routerAddr, ethers.MaxUint256, {
              gasLimit: 100000 // Conservative gas limit for approvals
            });
            
            console.log(`      ⏳ Tx submitted: ${approveTx.hash}`);
            totalTxs++;
            
            const receipt = await approveTx.wait();
            
            if (receipt.status === 1) {
              console.log(`      ✅ Approval successful! Gas used: ${receipt.gasUsed}`);
              successfulTxs++;
            } else {
              console.log(`      ❌ Approval failed`);
            }
            
            // Small delay between transactions
            await new Promise(resolve => setTimeout(resolve, 2000));
            
          } else {
            console.log(`      ✅ Already approved (sufficient allowance)`);
          }
          
        } catch (approvalError) {
          console.log(`      ❌ Approval error: ${approvalError.message}`);
        }
      }
      
    } catch (tokenError) {
      console.log(`   ❌ Token error: ${tokenError.message}`);
    }
  }
  
  console.log('\n📊 APPROVAL SUMMARY:');
  console.log('====================');
  console.log(`Total transactions sent: ${totalTxs}`);
  console.log(`Successful approvals: ${successfulTxs}`);
  console.log(`Failed approvals: ${totalTxs - successfulTxs}`);
  
  if (successfulTxs > 0) {
    console.log('\n✅ Token approvals completed!');
    console.log('Your bot should now be able to execute trades.');
    console.log('\nNext steps:');
    console.log('1. Restart your bot');
    console.log('2. Monitor for successful trades');
    console.log('3. Consider increasing slippage if trades still fail');
  } else {
    console.log('\n❌ No approvals were successful.');
    console.log('Check your wallet balance and RPC connection.');
  }
}

// Special function to approve just USDT for BaseSwap (the failing token)
async function approveUSDTOnly() {
  console.log('🎯 USDT-ONLY APPROVAL (Quick Fix)');
  console.log('==================================\n');
  
  const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL, 8453);
  const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);
  
  const USDT = '0xeb466342c4d449bc9f53a865d5cb90586f405215';
  const BASESWAP_ROUTER = '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86';
  
  const ERC20_ABI = [
    'function approve(address spender, uint256 value) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address) view returns (uint256)'
  ];
  
  const usdt = new ethers.Contract(USDT, ERC20_ABI, wallet);
  const address = await wallet.getAddress();
  
  const [balance, allowance] = await Promise.all([
    usdt.balanceOf(address),
    usdt.allowance(address, BASESWAP_ROUTER)
  ]);
  
  console.log(`USDT Balance: ${ethers.formatUnits(balance, 6)} USDT`);
  console.log(`Current Allowance: ${ethers.formatUnits(allowance, 6)} USDT`);
  
  if (balance > 0n && allowance === 0n) {
    console.log('\n🔐 Approving USDT for BaseSwap...');
    
    const tx = await usdt.approve(BASESWAP_ROUTER, ethers.MaxUint256);
    console.log(`Tx: ${tx.hash}`);
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log('✅ USDT approved! Your bot should work now.');
    } else {
      console.log('❌ Approval failed');
    }
  } else {
    console.log('ℹ️  No approval needed or no USDT balance');
  }
}

// Main execution
if (process.argv.includes('--usdt-only')) {
  approveUSDTOnly().catch(console.error);
} else {
  approveAllTokens().catch(console.error);
}