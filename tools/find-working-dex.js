// find-working-dex.js - Find any working DEX on Base
require('dotenv').config();
const { ethers } = require('ethers');

async function findWorkingDex() {
  console.log('🔍 Finding working DEX on Base...\n');
  
  const provider = new ethers.JsonRpcProvider(
    process.env.EVM_RPC_URL,
    parseInt(process.env.EVM_CHAIN_ID || '8453', 10)
  );
  
  const WETH = '0x4200000000000000000000000000000000000006';
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  
  // Multiple DEXs to try on Base
  const DEXS_TO_TRY = [
    {
      name: 'Aerodrome V2',
      router: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
      type: 'v2'
    },
    {
      name: 'BaseSwap', 
      router: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86',
      type: 'v2'
    },
    {
      name: 'SushiSwap V2',
      router: '0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891',
      type: 'v2'
    },
    {
      name: 'PancakeSwap V2',
      router: '0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb',
      type: 'v2'
    },
    {
      name: 'Maverick V1',
      router: '0x32AED3Bce901DA12ca8489788F3A99fCe1056e14',
      type: 'maverick'
    }
  ];
  
  const V2_ROUTER_ABI = [
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
    'function factory() external view returns (address)',
    'function WETH() external view returns (address)'
  ];
  
  const amountIn = ethers.parseEther('0.0001');
  const path = [WETH, USDC];
  
  console.log('Testing DEXs with 0.0001 WETH -> USDC...\n');
  
  for (const dex of DEXS_TO_TRY) {
    console.log(`📊 Testing ${dex.name}...`);
    
    try {
      // Check if contract exists
      const code = await provider.getCode(dex.router);
      if (code === '0x') {
        console.log(`❌ Contract not found\n`);
        continue;
      }
      
      console.log(`✅ Contract exists`);
      
      if (dex.type === 'v2') {
        const router = new ethers.Contract(dex.router, V2_ROUTER_ABI, provider);
        
        // Test basic contract calls first
        try {
          const factory = await router.factory();
          console.log(`✅ Factory: ${factory}`);
        } catch (e) {
          console.log(`❌ Factory call failed: ${e.message}`);
        }
        
        try {
          const weth = await router.WETH();
          console.log(`✅ WETH: ${weth}`);
        } catch (e) {
          console.log(`❌ WETH call failed: ${e.message}`);
        }
        
        // Test quote
        try {
          console.log(`🔍 Testing quote...`);
          const amounts = await router.getAmountsOut(amountIn, path, {
            gasLimit: 8000000 // High gas limit for testing
          });
          
          const amountOut = amounts[amounts.length - 1];
          const rate = (Number(amountOut) / 1e6) / 0.0001;
          
          console.log(`✅ Quote successful!`);
          console.log(`   Out: ${Number(amountOut) / 1e6} USDC`);
          console.log(`   Rate: ${rate.toFixed(2)} USDC per WETH`);
          
          // Sanity check - rate should be between 3000-5000
          if (rate > 3000 && rate < 5000) {
            console.log(`🎯 ${dex.name} WORKS! Rate looks realistic.`);
            
            // This DEX works, let's test a small trade
            await testSmallTrade(provider, dex, WETH, USDC, amountIn);
            
          } else {
            console.log(`⚠️  Rate seems unrealistic (${rate.toFixed(2)})`);
          }
          
        } catch (quoteError) {
          console.log(`❌ Quote failed: ${quoteError.reason || quoteError.message}`);
        }
      }
      
    } catch (e) {
      console.log(`❌ Error: ${e.message}`);
    }
    
    console.log(''); // Empty line between DEXs
  }
  
  // Test a simple token transfer to see if the issue is more basic
  console.log('🧪 Testing basic WETH contract...');
  await testWethContract(provider, WETH);
}

async function testSmallTrade(provider, dex, WETH, USDC, amountIn) {
  console.log(`   🚀 Testing small trade execution...`);
  
  try {
    const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);
    
    const EXECUTE_ABI = [
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
    ];
    
    const router = new ethers.Contract(dex.router, EXECUTE_ABI, wallet);
    const recipient = await wallet.getAddress();
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const path = [WETH, USDC];
    
    // Very low minimum (90% slippage for testing)
    const minOut = 1000; // 0.001 USDC minimum
    
    const gasEstimate = await router.swapExactTokensForTokens.estimateGas(
      amountIn,
      minOut,
      path,
      recipient,
      deadline
    );
    
    console.log(`   ✅ Gas estimation successful: ${gasEstimate.toString()}`);
    console.log(`   🎯 ${dex.name} CAN EXECUTE TRADES!`);
    
    return true;
    
  } catch (execError) {
    console.log(`   ❌ Execution test failed: ${execError.reason || execError.message}`);
    
    if (execError.message.includes('STF') || execError.message.includes('transfer')) {
      console.log(`   💡 Transfer issue - probably need approval`);
    }
    
    return false;
  }
}

async function testWethContract(provider, WETH) {
  const ERC20_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)'
  ];
  
  try {
    const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);
    const address = await wallet.getAddress();
    
    const wethContract = new ethers.Contract(WETH, ERC20_ABI, provider);
    
    const [name, symbol, totalSupply, balance] = await Promise.all([
      wethContract.name(),
      wethContract.symbol(),
      wethContract.totalSupply(),
      wethContract.balanceOf(address)
    ]);
    
    console.log(`✅ WETH contract working:`);
    console.log(`   Name: ${name}`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Total Supply: ${ethers.formatEther(totalSupply)}`);
    console.log(`   Your Balance: ${ethers.formatEther(balance)}`);
    
  } catch (e) {
    console.log(`❌ WETH contract test failed: ${e.message}`);
  }
}

findWorkingDex().catch(console.error);