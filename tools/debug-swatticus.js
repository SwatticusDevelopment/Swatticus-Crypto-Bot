// test-universal-router.js - Test Uniswap Universal Router (Base's main router)
require('dotenv').config();
const { ethers } = require('ethers');

async function testUniversalRouter() {
  console.log('🌐 Testing Uniswap Universal Router on Base...\n');
  
  const provider = new ethers.JsonRpcProvider(
    process.env.EVM_RPC_URL,
    parseInt(process.env.EVM_CHAIN_ID || '8453', 10)
  );
  
  const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);
  
  const WETH = '0x4200000000000000000000000000000000000006';
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const UNIVERSAL_ROUTER = '0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC';
  
  // Universal Router uses a different interface with commands
  const UNIVERSAL_ROUTER_ABI = [
    'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable'
  ];
  
  const router = new ethers.Contract(UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_ABI, wallet);
  
  // Get expected output using our working calculation
  const { spotAmountOut } = require('../src/js/v3Spot');
  const amountIn = ethers.parseEther('0.0001');
  const fee = 500;
  
  console.log('🧮 Calculating expected output...');
  const expectedOut = await spotAmountOut(WETH, USDC, fee, amountIn);
  console.log('Expected USDC out:', Number(expectedOut) / 1e6);
  
  // Very generous slippage (30%)
  const minOut = (BigInt(expectedOut) * 70n) / 100n;
  console.log('Min USDC out (30% slippage):', Number(minOut) / 1e6);
  
  // Universal Router command for V3 swap
  // Command 0x00 = V3_SWAP_EXACT_IN
  const commands = '0x00';
  
  // Encode the swap parameters for Universal Router
  const recipient = await wallet.getAddress();
  const deadline = Math.floor(Date.now() / 1000) + 600;
  
  // Universal Router expects different encoding
  const swapData = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'uint256', 'bytes', 'bool'],
    [
      recipient,           // recipient
      amountIn,           // amountIn
      minOut,             // amountOutMin
      ethers.solidityPacked(  // path (token0, fee, token1)
        ['address', 'uint24', 'address'],
        [WETH, fee, USDC]
      ),
      false               // payerIsUser
    ]
  );
  
  const inputs = [swapData];
  
  console.log('\n🚀 Testing Universal Router...');
  console.log('Command:', commands);
  console.log('Amount in:', ethers.formatEther(amountIn), 'WETH');
  console.log('Min out:', Number(minOut) / 1e6, 'USDC');
  
  try {
    // Test gas estimation
    const gasEstimate = await router.execute.estimateGas(commands, inputs, deadline);
    console.log('✅ Universal Router gas estimation successful:', gasEstimate.toString());
    
    // If gas estimation works, execute the trade
    console.log('⏳ Executing trade...');
    
    const tx = await router.execute(commands, inputs, deadline, {
      gasLimit: gasEstimate + (gasEstimate / 10n)
    });
    
    console.log('Transaction hash:', tx.hash);
    console.log('⏳ Waiting for confirmation...');
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log('🎉 UNIVERSAL ROUTER TRADE SUCCESSFUL!');
      console.log('Gas used:', receipt.gasUsed.toString());
      
      // Check new balances
      const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
      const usdcContract = new ethers.Contract(USDC, ERC20_ABI, provider);
      const newUsdcBalance = await usdcContract.balanceOf(recipient);
      
      console.log('New USDC balance:', Number(newUsdcBalance) / 1e6);
      
      console.log('\n🎯 SUCCESS! Universal Router is the correct router for Base!');
      console.log('Your bot should use Universal Router instead of SwapRouter02');
      
    } else {
      console.log('❌ Transaction failed');
    }
    
  } catch (gasError) {
    console.log('❌ Universal Router gas estimation failed:', gasError.reason || gasError.message);
    
    // Try alternative encoding
    console.log('\n🔄 Trying alternative encoding...');
    
    try {
      // Alternative: simpler encoding
      const altSwapData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256', 'uint256', 'bytes'],
        [
          recipient,
          amountIn,
          minOut,
          ethers.solidityPacked(['address', 'uint24', 'address'], [WETH, fee, USDC])
        ]
      );
      
      const altInputs = [altSwapData];
      
      const altGasEstimate = await router.execute.estimateGas(commands, altInputs, deadline);
      console.log('✅ Alternative encoding works:', altGasEstimate.toString());
      
    } catch (altError) {
      console.log('❌ Alternative encoding also failed:', altError.reason || altError.message);
      
      // Log what we learned
      console.log('\n📋 Summary:');
      console.log('- Standard SwapRouter02: ❌ Fails with missing revert data');
      console.log('- Universal Router: ❌ Encoding issues');
      console.log('- Quoter contracts: ❌ All broken on Base');
      console.log('\n💡 Recommendation: Use a different DEX (Aerodrome, BaseSwap)');
    }
  }
}

testUniversalRouter().catch(console.error);