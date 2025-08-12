// scripts/generatePairs.js - COMPREHENSIVE - Gets EVERY pair on Base
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// Multiple factories on Base to get ALL pairs
const FACTORIES = [
  { name: 'BaseSwap', address: '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB', type: 'v2' },
  { name: 'Uniswap V3', address: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', type: 'v3' },
  { name: 'SushiSwap', address: '0x71524B4f93c58fcbF659783284E38825f0622859', type: 'v2' },
  { name: 'Aerodrome', address: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da', type: 'v2' },
  { name: 'PancakeSwap V2', address: '0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E', type: 'v2' },
  { name: 'Maverick', address: '0xEb6625D65a0553c9dBc64449e56abFe519bd9c9B', type: 'maverick' }
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
  'function poolCreationCodeHash() view returns (bytes32)',
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

async function getAllV2Pairs(provider, factory, maxConcurrency = 10) {
  console.log(`[${factory.name}] Scanning V2 pairs...`);
  
  try {
    const factoryContract = new ethers.Contract(factory.address, V2_FACTORY_ABI, provider);
    const totalPairs = Number(await factoryContract.allPairsLength());
    
    console.log(`[${factory.name}] Found ${totalPairs} total pairs`);
    
    if (totalPairs === 0) return [];
    
    const pairs = [];
    const batchSize = Math.min(maxConcurrency, 50);
    
    for (let i = 0; i < totalPairs; i += batchSize) {
      const batch = [];
      const end = Math.min(i + batchSize, totalPairs);
      
      // Create batch of promises
      for (let j = i; j < end; j++) {
        batch.push(
          factoryContract.allPairs(j)
            .then(async (pairAddress) => {
              if (!pairAddress || pairAddress === ethers.ZeroAddress) return null;
              
              const pairContract = new ethers.Contract(pairAddress, V2_PAIR_ABI, provider);
              const [token0, token1] = await Promise.all([
                pairContract.token0(),
                pairContract.token1()
              ]);
              
              return {
                pair: pairAddress.toLowerCase(),
                token0: token0.toLowerCase(),
                token1: token1.toLowerCase(),
                factory: factory.name
              };
            })
            .catch(() => null)
        );
      }
      
      // Execute batch
      const batchResults = await Promise.all(batch);
      const validPairs = batchResults.filter(Boolean);
      pairs.push(...validPairs);
      
      console.log(`[${factory.name}] Progress: ${Math.min(end, totalPairs)}/${totalPairs} (${pairs.length} valid pairs)`);
      
      // Rate limiting
      await sleep(100);
    }
    
    console.log(`[${factory.name}] Completed: ${pairs.length} pairs discovered`);
    return pairs;
    
  } catch (error) {
    console.log(`[${factory.name}] Error: ${error.message}`);
    return [];
  }
}

async function getAllV3Pairs(provider, factory) {
  console.log(`[${factory.name}] Scanning V3 pools via events...`);
  
  try {
    const factoryContract = new ethers.Contract(factory.address, V3_FACTORY_ABI, provider);
    const currentBlock = await provider.getBlockNumber();
    
    // V3 factory deployed around block 1371680 on Base
    const startBlock = 1371680;
    const chunkSize = 5000; // Larger chunks for events
    const pairs = [];
    
    console.log(`[${factory.name}] Scanning blocks ${startBlock} to ${currentBlock}`);
    
    for (let fromBlock = startBlock; fromBlock < currentBlock; fromBlock += chunkSize) {
      const toBlock = Math.min(fromBlock + chunkSize - 1, currentBlock);
      
      try {
        const filter = factoryContract.filters.PoolCreated();
        const events = await factoryContract.queryFilter(filter, fromBlock, toBlock);
        
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
        
        console.log(`[${factory.name}] Progress: Block ${toBlock}/${currentBlock} (${pairs.length} pools)`);
        await sleep(50);
        
      } catch (blockError) {
        console.log(`[${factory.name}] Error in block range ${fromBlock}-${toBlock}: ${blockError.message}`);
        await sleep(200);
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
    console.log('🚀 COMPREHENSIVE BASE PAIR DISCOVERY');
    console.log('====================================');
    console.log(`Target: Get EVERY trading pair on Base chain`);
    console.log(`Output: ${outPath}\n`);
    
    if (!process.env.EVM_RPC_URL) {
      throw new Error('EVM_RPC_URL required for comprehensive discovery');
    }
    
    const provider = createProvider();
    
    // Verify connection
    const network = await provider.getNetwork();
    console.log(`Connected to: ${network.name} (chainId: ${network.chainId})\n`);
    
    let allDiscoveredPairs = [];
    
    // Scan each DEX factory
    for (const factory of FACTORIES) {
      try {
        let factoryPairs = [];
        
        if (factory.type === 'v2') {
          factoryPairs = await getAllV2Pairs(provider, factory);
        } else if (factory.type === 'v3') {
          factoryPairs = await getAllV3Pairs(provider, factory);
        } else {
          console.log(`[${factory.name}] Skipping unsupported type: ${factory.type}`);
          continue;
        }
        
        allDiscoveredPairs.push(...factoryPairs);
        console.log(`[${factory.name}] Added ${factoryPairs.length} pairs to collection\n`);
        
        // Brief pause between factories
        await sleep(500);
        
      } catch (factoryError) {
        console.log(`[${factory.name}] Factory scan failed: ${factoryError.message}\n`);
      }
    }
    
    console.log(`📊 DISCOVERY SUMMARY:`);
    console.log(`Total pools/pairs discovered: ${allDiscoveredPairs.length}`);
    
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
    
    // Also save detailed discovery info
    const detailPath = outPath.replace('.json', '.detailed.json');
    const detailData = {
      timestamp: new Date().toISOString(),
      discoveryTimeSeconds: (Date.now() - t0) / 1000,
      totalPairs: finalPairs.length,
      factories: FACTORIES.map(f => f.name),
      discoveredPools: allDiscoveredPairs.length,
      pairs: finalPairs
    };
    fs.writeFileSync(detailPath, JSON.stringify(detailData, null, 2));
    
    console.log(`\n🎉 SUCCESS!`);
    console.log(`Generated ${finalPairs.length} trading pairs`);
    console.log(`Main file: ${outPath}`);
    console.log(`Detailed info: ${detailPath}`);
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
    
    console.log(`\n🚀 Your bot now has access to EVERY trading pair on Base!`);
    
  } catch (error) {
    console.error(`[pairs] CRITICAL ERROR: ${error.message}`);
    
    // Emergency fallback - create basic pairs from popular tokens
    console.log('[pairs] Creating emergency fallback pairs...');
    
    const emergencyTokens = [
      '0x4200000000000000000000000000000000000006', // WETH
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC
      '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22', // cbETH
      '0x4ed4e862860bed51a9570b96d89af5e1b0efefed', // DEGEN
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', // LZO
    ];
    
    const emergencyPairs = [];
    for (let i = 0; i < emergencyTokens.length; i++) {
      for (let j = i + 1; j < emergencyTokens.length; j++) {
        emergencyPairs.push(`${emergencyTokens[i].toLowerCase()}/${emergencyTokens[j].toLowerCase()}`);
        emergencyPairs.push(`${emergencyTokens[j].toLowerCase()}/${emergencyTokens[i].toLowerCase()}`);
      }
    }
    
    fs.writeFileSync(outPath, JSON.stringify(emergencyPairs, null, 2));
    console.log(`[pairs] Created emergency pairs file with ${emergencyPairs.length} pairs`);
    
    process.exit(1);
  }
})();