// emergency-approve-all.js - Pre-approve all tokens to avoid execution delays
require('dotenv').config();
const { ethers } = require('ethers');

async function emergencyApproveAll() {
  console.log('🚨 EMERGENCY TOKEN APPROVAL SCRIPT');
  console.log('==================================\n');
  
  const provider = new ethers.JsonRpcProvider(
    process.env.EVM_RPC_URL,
    parseInt(process.env.EVM_CHAIN_ID || '8453', 10)
  );
  
  const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);
  const address = await wallet.getAddress();
  
  console.log(`🔑 Wallet: ${address}`);
  console.log(`🌐 Network: Base (${await provider.getNetwork().then(n => n.chainId)})`);
  
  // Check ETH balance
  const ethBalance = await provider.getBalance(address);
  console.log(`💰 ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);
  
  if (ethBalance < ethers.parseEther('0.005')) {
    console.log('❌ ERROR: Need at least 0.005 ETH for gas fees');
    process.exit(1);
  }
  
  // All tokens that might be traded
  const TOKENS = [
    { name: 'WETH',  addr: '0x4200000000000000000000000000000000000006' },
    { name: 'USDC',  addr: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
    { name: 'USDT',  addr: '0xeb466342c4d449bc9f53a865d5cb90586f405215' },
    { name: 'USDbC', addr: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca' }
  ];
  
  // Routers to approve
  const ROUTERS = [
    { name: 'BaseSwap', addr: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86' }
  ];
  
  const ERC20_ABI = [
    'function symbol() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 value) returns (bool)',
    'function decimals() view returns (uint8)'
  ];
  
  let totalApprovals = 0;
  let successfulApprovals = 0;
  let skippedTokens = 0;
  
  console.log('\n📋 APPROVAL PROCESS STARTING...');
  console.log('===============================\n');
  
  for (const token of TOKENS) {
    console.log(`🪙 Processing ${token.name}...`);
    
    try {
      const tokenContract = new ethers.Contract(token.addr, ERC20_ABI, wallet);
      
      // Get token info
      const [symbol, decimals, balance] = await Promise.all([
        tokenContract.symbol().catch(() => token.name),
        tokenContract.decimals().catch(() => 18),
        tokenContract.balanceOf(address)
      ]);
      
      console.log(`   Symbol: ${symbol}`);
      console.log(`   Balance: ${ethers.formatUnits(balance, decimals)} ${symbol}`);
      
      if (balance === 0n) {
        console.log(`   ⏭️  Skipping (zero balance)`);
        skippedTokens++;
        continue;
      }
      
      for (const router of ROUTERS) {
        try {
          console.log(`\n   🔍 Checking ${router.name} approval...`);
          
          const currentAllowance = await tokenContract.allowance(address, router.addr);
          console.log(`      Current allowance: ${ethers.formatUnits(currentAllowance, decimals)} ${symbol}`);
          
          if (currentAllowance < balance) {
            console.log(`      📝 Approving unlimited ${symbol} for ${router.name}...`);
            totalApprovals++;
            
            // Use conservative gas settings
            const gasLimit = 100000n;
            const gasPrice = process.env.FIXED_GAS_PRICE_WEI ? 
              BigInt(process.env.FIXED_GAS_PRICE_WEI) : 
              await provider.getFeeData().then(f => f.gasPrice);
            
            const approveTx = await tokenContract.approve(router.addr, ethers.MaxUint256, {
              gasLimit,
              gasPrice
            });
            
            console.log(`      ⏳ Transaction: ${approveTx.hash}`);
            
            const receipt = await approveTx.wait();
            
            if (receipt.status === 1) {
              console.log(`      ✅ Approval successful! Gas used: ${receipt.gasUsed}`);
              successfulApprovals++;
              
              // Verify approval
              const newAllowance = await tokenContract.allowance(address, router.addr);
              if (newAllowance >= balance) {
                console.log(`      ✅ Verification passed: ${ethers.formatUnits(newAllowance, decimals)} ${symbol}`);
              } else {
                console.log(`      ⚠️  Verification warning: ${ethers.formatUnits(newAllowance, decimals)} ${symbol}`);
              }
              
            } else {
              console.log(`      ❌ Approval failed (status: ${receipt.status})`);
            }
            
            // Wait between transactions
            await new Promise(resolve => setTimeout(resolve, 3000));
            
          } else {
            console.log(`      ✅ Already approved (sufficient allowance)`);
          }
          
        } catch (routerError) {
          console.log(`      ❌ Router ${router.name} error: ${routerError.message}`);
        }
      }
      
    } catch (tokenError) {
      console.log(`   ❌ Token ${token.name} error: ${tokenError.message}`);
    }
    
    console.log(''); // Space between tokens
  }
  
  // Final summary
  console.log('\n📊 APPROVAL SUMMARY');
  console.log('===================');
  console.log(`Total approval attempts: ${totalApprovals}`);
  console.log(`Successful approvals: ${successfulApprovals}`);
  console.log(`Skipped tokens (zero balance): ${skippedTokens}`);
  console.log(`Failed approvals: ${totalApprovals - successfulApprovals}`);
  
  // Check final ETH balance
  const finalEthBalance = await provider.getBalance(address);
  const ethUsed = ethBalance - finalEthBalance;
  console.log(`ETH used for gas: ${ethers.formatEther(ethUsed)} ETH`);
  console.log(`Remaining ETH: ${ethers.formatEther(finalEthBalance)} ETH`);
  
  if (successfulApprovals > 0) {
    console.log('\n🎉 SUCCESS! Tokens are now pre-approved!');
    console.log('✅ Your bot will execute trades without approval delays');
    console.log('✅ No more "TransferHelper::transferFrom" errors');
    console.log('\nNext steps:');
    console.log('1. Run: Start_Fixed.bat');
    console.log('2. Watch for successful trades in the dashboard');
    console.log('3. Monitor profit accumulation');
    
    // Create approval success marker
    const fs = require('fs');
    const approvalRecord = {
      timestamp: new Date().toISOString(),
      wallet: address,
      successfulApprovals,
      totalApprovals,
      ethUsed: ethers.formatEther(ethUsed)
    };
    
    fs.writeFileSync('approval-success.json', JSON.stringify(approvalRecord, null, 2));
    console.log('\n📁 Approval record saved to: approval-success.json');
    
  } else if (totalApprovals === 0) {
    console.log('\n✅ All tokens were already approved!');
    console.log('Your bot is ready to trade immediately.');
    
  } else {
    console.log('\n❌ Some approvals failed.');
    console.log('❓ Try running the script again or check:');
    console.log('   - ETH balance for gas fees');
    console.log('   - RPC connection stability');
    console.log('   - Gas price settings');
  }
}

// Run the emergency approval
if (require.main === module) {
  emergencyApproveAll().catch(error => {
    console.error('\n💥 CRITICAL ERROR:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Check your .env file configuration');
    console.error('2. Verify EVM_RPC_URL is working');
    console.error('3. Ensure EVM_PRIVATE_KEY is correct');
    console.error('4. Check wallet has ETH for gas');
    process.exit(1);
  });
}

module.exports = { emergencyApproveAll };