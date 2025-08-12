// scripts/generatePairs.js - FIXED - Respects RPC block limits
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// Conservative settings to avoid RPC limits
const MAX_BLOCK_RANGE = 200;           // Much smaller chunks (RPC limit is 500)
const BATCH_DELAY_MS = 250;            // Longer delays between requests
const MAX_CONCURRENT_BATCHES = 2;      // Very conservative concurrency
const REQUEST_TIMEOUT_MS = 30000;      // 30 second timeout

// Multiple factories on Base
const FACTORIES = [
  { name: 'BaseSwap', address: '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB', type: 'v2' },
  { name: 'Uniswap V3', address: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', type: 'v3' },
  { name: 'Aerodrome', address: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da', type: 'v2' },
  { name: 'SushiSwap', address: '0x71524B4f93c58fcbF659783284E38825f0622859', type: 'v2' }
];

const V2_FACTORY_ABI = [
  'function allPairsLength() view returns (uint256)',
  'function allPairs(uint256) view returns (address)'
];

const V2_PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];

const V3_FACTORY_ABI = [
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)'
];

function createProvider() {
  const urls = [
    process.env.EVM_RPC_URL,
    process.env.EVM_RPC_URL_2,
    'https://mainnet.base.org'
  ].filter(Boolean);
  
  return new ethers.JsonRpcProvider(urls[0], { chainId: 8453, name: 'base' });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs, description) {
  const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(`${description} timeout after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

async function getAllV2Pairs(provider, factory) {
  console.log(`[${factory.name}] Scanning V2 pairs...`);
  
  try {
    const factoryContract = new ethers.Contract(factory.address, V2_FACTORY_ABI, provider);
    const totalPairs = Number(await withTimeout(
      factoryContract.allPairsLength(), 
      REQUEST_TIMEOUT_MS, 
      'allPairsLength'
    ));
    
    console.log(`[${factory.name}] Found ${totalPairs} total pairs`);
    
    if (totalPairs === 0) return [];
    
    const pairs = [];
    const batchSize = 10; // Very conservative batch size
    
    for (let i = 0; i < totalPairs; i += batchSize) {
      const batch = [];
      const end = Math.min(i + batchSize, totalPairs);
      
      // Create batch of promises
      for (let j = i; j < end; j++) {
        batch.push(
          withTimeout(
            factoryContract.allPairs(j)
              .then(async (pairAddress) => {
                if (!pairAddress || pairAddress === ethers.ZeroAddress) return null;
                
                const pairContract = new ethers.Contract(pairAddress, V2_PAIR_ABI, provider);
                const [token0, token1] = await Promise.all([
                  withTimeout(pairContract.token0(), REQUEST_TIMEOUT_MS, 'token0'),
                  withTimeout(pairContract.token1(), REQUEST_TIMEOUT_MS, 'token1')
                ]);
                
                return {
                  pair: pairAddress.toLowerCase(),
                  token0: token0.toLowerCase(),
                  token1: token1.toLowerCase(),
                  factory: factory.name
                };
              }),
            REQUEST_TIMEOUT_MS,
            `pair ${j}`
          ).catch(error => {
            console.log(`[${factory.name}] Error getting pair ${j}: ${error.message}`);
            return null;
          })
        );
      }
      
      // Execute batch with error handling
      const batchResults = await Promise.all(batch);
      const validPairs = batchResults.filter(Boolean);
      pairs.push(...validPairs);
      
      console.log(`[${factory.name}] Progress: ${Math.min(end, totalPairs)}/${totalPairs} (${pairs.length} valid pairs)`);
      
      // Rate limiting - longer delay
      await sleep(BATCH_DELAY_MS);
    }
    
    console.log(`[${factory.name}] Completed: ${pairs.length} pairs discovered`);
    return pairs;
    
  } catch (error) {
    console.log(`[${factory.name}] Error: ${error.message}`);
    return [];
  }
}

async function getAllV3PairsConservative(provider, factory) {
  console.log(`[${factory.name}] Scanning V3 pools with conservative settings...`);
  
  try {
    const factoryContract = new ethers.Contract(factory.address, V3_FACTORY_ABI, provider);
    const currentBlock = await withTimeout(
      provider.getBlockNumber(), 
      REQUEST_TIMEOUT_MS, 
      'getBlockNumber'
    );
    
    // Start from a more recent block to reduce scan time
    const startBlock = Math.max(currentBlock - 500000, 1371680); // Last 500k blocks or factory deploy
    const pairs = [];
    
    console.log(`[${factory.name}] Scanning blocks ${startBlock} to ${currentBlock} (${currentBlock - startBlock} blocks)`);
    console.log(`[${factory.name}] Using ${MAX_BLOCK_RANGE} block chunks with ${BATCH_DELAY_MS}ms delays`);
    
    for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += MAX_BLOCK_RANGE) {
      const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, currentBlock);
      
      try {
        const filter = factoryContract.filters.PoolCreated();
        
        const events = await withTimeout(
          factoryContract.queryFilter(filter, fromBlock, toBlock),
          REQUEST_TIMEOUT_MS,
          `queryFilter ${fromBlock}-${toBlock}`
        );
        
        for (const event of events) {
          if (event.args) {
            pairs.push({
              pair: event.args.pool.toLowerCase(),
              token0: event.args.token0.toLowerCase(), 
              token1: event.args.token1.toLowerCase(),
              fee: Number(event.args.fee),
              factory: factory.name
            });
          }
        }
        
        const progress = ((fromBlock - startBlock) / (currentBlock - startBlock) * 100).toFixed(1);
        console.log(`[${factory.name}] Progress: ${progress}% - Block ${toBlock}/${currentBlock} (${pairs.length} pools)`);
        
        // Longer delay to respect RPC limits
        await sleep(BATCH_DELAY_MS);
        
      } catch (blockError) {
        console.log(`[${factory.name}] Error in block range ${fromBlock}-${toBlock}: ${blockError.message}`);
        
        // If we hit rate limits, wait longer
        if (blockError.message.includes('rate') || blockError.message.includes('limit')) {
          console.log(`[${factory.name}] Rate limited, waiting 2 seconds...`);
          await sleep(2000);
        } else {
          await sleep(BATCH_DELAY_MS * 2);
        }
      }
    }
    
    console.log(`[${factory.name}] Completed: ${pairs.length} pools discovered`);
    return pairs;
    
  } catch (error) {
    console.log(`[${factory.name}] Error: ${error.message}`);
    return [];
  }
}

function generateAllTradingPairs(discoveredPairs) {
  console.log('[pairs] Generating all possible trading pairs...');
  
  // Extract all unique tokens
  const allTokens = new Set();
  
  discoveredPairs.forEach(pair => {
    allTokens.add(pair.token0);
    allTokens.add(pair.token1);
  });
  
  const tokenArray = Array.from(allTokens);
  console.log(`[pairs] Found ${tokenArray.length} unique tokens across all DEXs`);
  
  // Generate all possible pairs (both directions)
  const tradingPairs = [];
  const pairSet = new Set();
  
  // Add direct pairs from discovered pools
  discoveredPairs.forEach(pool => {
    const pair1 = `${pool.token0}/${pool.token1}`;
    const pair2 = `${pool.token1}/${pool.token0}`;
    
    if (!pairSet.has(pair1)) {
      tradingPairs.push(pair1);
      pairSet.add(pair1);
    }
    if (!pairSet.has(pair2)) {
      tradingPairs.push(pair2);
      pairSet.add(pair2);
    }
  });
  
  console.log(`[pairs] Generated ${tradingPairs.length} trading pairs from discovered pools`);
  return tradingPairs;
}

(async () => {
  const outPath = process.env.EVM_PAIRS_FILE || process.env.EVM_PAIRS_OUT || 'pairs.base.json';
  const t0 = Date.now();
  
  try {
    console.log('🚀 CONSERVATIVE BASE PAIR DISCOVERY');
    console.log('===================================');
    console.log(`Settings: ${MAX_BLOCK_RANGE} block chunks, ${BATCH_DELAY_MS}ms delays`);
    console.log(`Output: ${outPath}\n`);
    
    if (!process.env.EVM_RPC_URL) {
      throw new Error('EVM_RPC_URL required for discovery');
    }
    
    const provider = createProvider();
    
    // Verify connection
    const network = await withTimeout(provider.getNetwork(), REQUEST_TIMEOUT_MS, 'getNetwork');
    console.log(`Connected to: ${network.name} (chainId: ${network.chainId})\n`);
    
    let allDiscoveredPairs = [];
    
    // Scan each DEX factory (prioritize working ones first)
    const prioritizedFactories = [
      FACTORIES.find(f => f.name === 'BaseSwap'), // This was working in your logs
      ...FACTORIES.filter(f => f.name !== 'BaseSwap')
    ].filter(Boolean);
    
    for (const factory of prioritizedFactories) {
      try {
        console.log(`\n🔍 Scanning ${factory.name}...`);
        let factoryPairs = [];
        
        if (factory.type === 'v2') {
          factoryPairs = await getAllV2Pairs(provider, factory);
        } else if (factory.type === 'v3') {
          factoryPairs = await getAllV3PairsConservative(provider, factory);
        }
        
        allDiscoveredPairs.push(...factoryPairs);
        console.log(`[${factory.name}] ✅ Added ${factoryPairs.length} pairs to collection`);
        
        // Brief pause between factories
        await sleep(1000);
        
      } catch (factoryError) {
        console.log(`[${factory.name}] ❌ Factory scan failed: ${factoryError.message}`);
      }
    }
    
    console.log(`\n📊 DISCOVERY SUMMARY:`);
    console.log(`Total pools/pairs discovered: ${allDiscoveredPairs.length}`);
    
    if (allDiscoveredPairs.length === 0) {
      throw new Error('No pairs discovered from any factory');
    }
    
    // Generate all possible trading pairs
    const tradingPairs = generateAllTradingPairs(allDiscoveredPairs);
    
    // Apply exclusions if any
    let finalPairs = tradingPairs;
    if (process.env.EVM_PAIR_EXCLUDE) {
      const excludeList = process.env.EVM_PAIR_EXCLUDE.split(',').map(s => s.trim());
      const excludeSet = new Set();
      
      excludeList.forEach(ex => {
        const [a, b] = ex.split('/').map(s => s.trim().toLowerCase());
        if (a && b) {
          excludeSet.add(`${a}/${b}`);
          excludeSet.add(`${b}/${a}`);
        }
      });
      
      const beforeCount = finalPairs.length;
      finalPairs = finalPairs.filter(p => !excludeSet.has(p.toLowerCase()));
      console.log(`Applied exclusions: ${beforeCount} -> ${finalPairs.length} pairs`);
    }
    
    // Save comprehensive pairs file
    fs.writeFileSync(outPath, JSON.stringify(finalPairs, null, 2));
    
    console.log(`\n🎉 SUCCESS!`);
    console.log(`Generated ${finalPairs.length} trading pairs`);
    console.log(`File: ${outPath}`);
    console.log(`Discovery time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    
    // Show factory breakdown
    console.log(`\n📈 FACTORY BREAKDOWN:`);
    const factoryStats = {};
    allDiscoveredPairs.forEach(pair => {
      factoryStats[pair.factory] = (factoryStats[pair.factory] || 0) + 1;
    });
    Object.entries(factoryStats).forEach(([factory, count]) => {
      console.log(`   ${factory}: ${count} pairs`);
    });
    
    // Show sample pairs
    console.log(`\n📋 Sample pairs: ${finalPairs.slice(0, 10).join(', ')}...`);
    
    console.log(`\n🚀 Your bot now has ${finalPairs.length} trading pairs from Base DEXs!`);
    
  } catch (error) {
    console.error(`[pairs] CRITICAL ERROR: ${error.message}`);
    console.log('[pairs] Creating emergency fallback pairs...');
    
    // Emergency fallback with known working pairs
    const emergencyPairs = [
      // WETH pairs (these were working in your logs)
      '0x4200000000000000000000000000000000000006/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // WETH/USDC
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913/0x4200000000000000000000000000000000000006', // USDC/WETH
      '0x4200000000000000000000000000000000000006/0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // WETH/USDbC
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca/0x4200000000000000000000000000000000000006', // USDbC/WETH
      
      // Popular Base tokens
      '0x4200000000000000000000000000000000000006/0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', // WETH/cbETH
      '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22/0x4200000000000000000000000000000000000006', // cbETH/WETH
      '0x4200000000000000000000000000000000000006/0x4ed4e862860bed51a9570b96d89af5e1b0efefed', // WETH/DEGEN
      '0x4ed4e862860bed51a9570b96d89af5e1b0efefed/0x4200000000000000000000000000000000000006', // DEGEN/WETH
      
      // Stablecoin pairs
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913/0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDC/USDbC
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDbC/USDC
    ];
    
    fs.writeFileSync(outPath, JSON.stringify(emergencyPairs, null, 2));
    console.log(`[pairs] Created emergency pairs file with ${emergencyPairs.length} pairs`);
    console.log('[pairs] Bot will start with known working pairs');
  }
})();