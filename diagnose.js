// diagnose.js - Quick diagnostic to identify the issue
require('dotenv').config();

console.log('🔍 SWATTICUS DIAGNOSTIC TOOL');
console.log('============================\n');

// Check Node.js version
console.log('1. Node.js Version:', process.version);
const nodeVersion = parseInt(process.version.slice(1));
if (nodeVersion < 16) {
  console.log('   ❌ ISSUE: Node.js version too old. Need 16+ for ethers v6');
} else {
  console.log('   ✅ Node.js version OK');
}

// Check .env file
console.log('\n2. Environment Configuration:');
if (!process.env.EVM_RPC_URL) {
  console.log('   ❌ CRITICAL: EVM_RPC_URL not set');
} else {
  const url = process.env.EVM_RPC_URL;
  if (url.includes('alchemy') || url.includes('infura') || url.includes('quicknode')) {
    console.log('   ✅ RPC URL configured (using hosted provider)');
  } else {
    console.log('   ⚠️  Using public RPC:', url);
  }
}

if (!process.env.EVM_PRIVATE_KEY) {
  console.log('   ❌ CRITICAL: EVM_PRIVATE_KEY not set');
} else if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.EVM_PRIVATE_KEY)) {
  console.log('   ❌ CRITICAL: EVM_PRIVATE_KEY format invalid');
} else {
  console.log('   ✅ Private key format OK');
}

// Check packages
console.log('\n3. Dependencies:');
try {
  const ethers = require('ethers');
  console.log('   ✅ ethers:', ethers.version || 'installed');
} catch (e) {
  console.log('   ❌ ethers not installed');
}

try {
  require('ws');
  console.log('   ✅ ws: installed');
} catch (e) {
  console.log('   ❌ ws not installed');
}

// Test RPC connection
console.log('\n4. RPC Connection Test:');
if (process.env.EVM_RPC_URL) {
  testRPC();
} else {
  console.log('   ⏭️  Skipped (no RPC URL)');
}

async function testRPC() {
  try {
    const { ethers } = require('ethers');
    console.log('   🔄 Testing RPC connection...');
    
    const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL, {
      chainId: 8453,
      name: 'base'
    });
    
    const blockNumber = await provider.getBlockNumber();
    console.log(`   ✅ RPC connected - Block: ${blockNumber}`);
    
    // Test BaseSwap factory
    const factoryAddress = '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB';
    const code = await provider.getCode(factoryAddress);
    if (code !== '0x') {
      console.log('   ✅ BaseSwap factory accessible');
    } else {
      console.log('   ❌ BaseSwap factory not found');
    }
    
  } catch (error) {
    console.log('   ❌ RPC connection failed:', error.message);
    
    if (error.message.includes('compute units')) {
      console.log('   💡 SOLUTION: Reduce BASE_RPC_RPS to 1 in .env');
    } else if (error.message.includes('network')) {
      console.log('   💡 SOLUTION: Check internet connection or try different RPC');
    }
  }
}

// Check file structure
console.log('\n5. File Structure:');
const criticalFiles = [
  'src/js/chainWorker.js',
  'src/js/baseSwapRouters.js',
  'src/js/multichainConfig.js',
  'package.json',
  'index.js'
];

criticalFiles.forEach(file => {
  const fs = require('fs');
  if (fs.existsSync(file)) {
    console.log(`   ✅ ${file}`);
  } else {
    console.log(`   ❌ ${file} missing`);
  }
});

console.log('\n6. Rate Limiting Settings:');
const rps = process.env.BASE_RPC_RPS || 'not set';
const concurrent = process.env.RPC_MAX_CONCURRENT || 'not set';
const interval = process.env.INTERVAL_MS || 'not set';

console.log(`   BASE_RPC_RPS: ${rps} ${rps > 5 ? '(⚠️  too high for free plans)' : ''}`);
console.log(`   RPC_MAX_CONCURRENT: ${concurrent} ${concurrent > 2 ? '(⚠️  too high)' : ''}`);
console.log(`   INTERVAL_MS: ${interval} ${interval < 2000 ? '(⚠️  too fast)' : ''}`);

console.log('\n🔧 RECOMMENDATIONS:');
console.log('');

if (!process.env.EVM_RPC_URL || !process.env.EVM_PRIVATE_KEY) {
  console.log('❗ CRITICAL: Configure .env file first');
  console.log('   Copy .env.example to .env and fill in:');
  console.log('   - EVM_RPC_URL (your Alchemy/Infura endpoint)');
  console.log('   - EVM_PRIVATE_KEY (your wallet private key)');
}

if ((process.env.BASE_RPC_RPS || 10) > 3) {
  console.log('❗ RATE LIMITING: Add to .env:');
  console.log('   BASE_RPC_RPS=1');
  console.log('   RPC_MAX_CONCURRENT=1');
  console.log('   INTERVAL_MS=3000');
}

console.log('');
console.log('🚀 QUICK FIXES:');
console.log('');
console.log('1. For immediate start: Run Start_Emergency.bat');
console.log('2. For pair generation issues: Use the fixed scripts/generatePairs.js');
console.log('3. For persistent errors: Set BASE_RPC_RPS=1 in .env');
console.log('');
console.log('📋 Need more help? Check the logs in the logs/ directory');

setTimeout(() => {
  console.log('\nDiagnostic complete. Press Ctrl+C to exit.');
}, 1000);