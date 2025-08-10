// Updated RPC configuration to use QuickNode endpoint
const https = require('https');
const http = require('http');

// Create persistent connection agents to reduce connection overhead
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 5 // Limit concurrent connections
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 5, // Limit concurrent connections
  timeout: 10000 // 10 second timeout
});

// Configure RPC endpoints - using QuickNode as primary endpoint
const RPC_ENDPOINTS = [
  {
    url: 'https://damp-falling-river.solana-mainnet.quiknode.pro/c9429d9a0d147f86cc09baa69e6adf899dff4898/',
    weight: 10, // Higher weight = higher priority
    rateLimit: {
      maxRequestsPerSecond: 10, // QuickNode has higher rate limits
      burstLimit: 20 // Allow larger bursts
    }
  },
  // Keep public endpoints as backup only
  {
    url: 'https://api.mainnet-beta.solana.com',
    weight: 3, // Lower priority
    rateLimit: {
      maxRequestsPerSecond: 1, // Very conservative with public endpoint
      burstLimit: 2 
    }
  },
  {
    url: 'https://solana-api.projectserum.com',
    weight: 2,
    rateLimit: {
      maxRequestsPerSecond: 1,
      burstLimit: 2
    }
  }
];

// Implement a simple token bucket rate limiter for each endpoint
const rateLimiters = RPC_ENDPOINTS.map(endpoint => {
  return {
    url: endpoint.url,
    tokens: endpoint.rateLimit.burstLimit,
    lastRefillTime: Date.now(),
    maxTokens: endpoint.rateLimit.burstLimit,
    tokenRefillRate: endpoint.rateLimit.maxRequestsPerSecond,
    weight: endpoint.weight
  };
});

// Function to get the best available RPC endpoint
async function getBestRpcEndpoint() {
  // For reliability, prioritize QuickNode
  return RPC_ENDPOINTS[0].url;
}

// Export the configuration
module.exports = {
  RPC_ENDPOINTS,
  rateLimiters,
  getBestRpcEndpoint,
  httpAgent,
  httpsAgent
};