// src/js/robustProvider.js - Rate-limited, network-pinned provider for Base
const { ethers } = require('ethers');

class RateLimitedProvider {
  constructor(urls, chainId = 8453) {
    this.urls = Array.isArray(urls) ? urls : [urls];
    this.chainId = chainId;
    this.network = { chainId, name: 'base' };
    this.currentIndex = 0;
    this.providers = [];
    this.requestQueue = [];
    this.processing = false;
    
    // Rate limiting config
    this.maxRPS = Number(process.env.BASE_RPC_RPS || '2'); // Conservative
    this.interval = Math.max(1000 / this.maxRPS, 500); // Min 500ms between requests
    this.lastRequest = 0;
    this.concurrent = 0;
    this.maxConcurrent = Number(process.env.RPC_MAX_CONCURRENT || '1');
    
    this.initProviders();
  }
  
  initProviders() {
    this.providers = this.urls.map(url => {
      // Pin network to avoid eth_chainId calls
      return new ethers.JsonRpcProvider(url, this.network);
    });
  }
  
  async waitForSlot() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;
    
    if (timeSinceLastRequest < this.interval) {
      const waitTime = this.interval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Wait for concurrent slot
    while (this.concurrent >= this.maxConcurrent) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.lastRequest = Date.now();
    this.concurrent++;
  }
  
  releaseSlot() {
    this.concurrent = Math.max(0, this.concurrent - 1);
  }
  
  getNextProvider() {
    const provider = this.providers[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.providers.length;
    return provider;
  }
  
  async callWithRetry(method, params, maxRetries = 3) {
    await this.waitForSlot();
    
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const provider = this.getNextProvider();
        const result = await provider.send(method, params);
        this.releaseSlot();
        return result;
      } catch (error) {
        lastError = error;
        
        // Check if it's a rate limit error
        const isRateLimit = error.code === 429 || 
          error.message?.includes('compute units') ||
          error.message?.includes('rate limit');
          
        if (isRateLimit && attempt < maxRetries - 1) {
          console.log(`[provider] Rate limited, waiting ${this.interval * 2}ms...`);
          await new Promise(resolve => setTimeout(resolve, this.interval * 2));
          continue;
        }
        
        // Network errors - try next provider
        if (error.message?.includes('network') && attempt < maxRetries - 1) {
          console.log(`[provider] Network error, trying next provider...`);
          continue;
        }
        
        break;
      }
    }
    
    this.releaseSlot();
    throw lastError;
  }
  
  // Implement JsonRpcProvider interface
  async send(method, params) {
    return this.callWithRetry(method, params);
  }
  
  async call(transaction) {
    return this.callWithRetry('eth_call', [transaction, 'latest']);
  }
  
  async getBlockNumber() {
    return this.callWithRetry('eth_blockNumber', []);
  }
  
  async getFeeData() {
    try {
      const gasPrice = await this.callWithRetry('eth_gasPrice', []);
      return {
        gasPrice: BigInt(gasPrice),
        maxFeePerGas: BigInt(gasPrice),
        maxPriorityFeePerGas: BigInt(Math.floor(Number(gasPrice) * 0.1))
      };
    } catch {
      // Fallback gas price
      const fallbackGas = BigInt(process.env.FALLBACK_GAS_PRICE || '1000000000'); // 1 gwei
      return {
        gasPrice: fallbackGas,
        maxFeePerGas: fallbackGas,
        maxPriorityFeePerGas: fallbackGas / 10n
      };
    }
  }
  
  async getNetwork() {
    return this.network;
  }
}

// Singleton instance
let providerInstance = null;

function createProvider() {
  const urls = [
    process.env.EVM_RPC_URL,
    process.env.EVM_RPC_URL_2,
    'https://mainnet.base.org' // Fallback to public RPC
  ].filter(Boolean);
  
  if (urls.length === 0) {
    throw new Error('No RPC URLs configured. Set EVM_RPC_URL.');
  }
  
  return new RateLimitedProvider(urls, 8453);
}

function getProvider() {
  if (!providerInstance) {
    providerInstance = createProvider();
  }
  return providerInstance;
}

module.exports = { getProvider, RateLimitedProvider };