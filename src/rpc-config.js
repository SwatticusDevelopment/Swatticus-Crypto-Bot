const http = require('http');
const https = require('https');

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

// Configure multiple RPC endpoints for redundancy
// Free tier RPCs often have rate limits, so it's good to have multiple options
const RPC_ENDPOINTS = [
  {
    url: 'https://api.mainnet-beta.solana.com',
    weight: 10, // Higher weight = higher priority
    rateLimit: {
      maxRequestsPerSecond: 2, // Limit to 2 requests per second
      burstLimit: 5 // Allow bursts up to 5 requests
    }
  },
  {
    url: 'https://solana-api.projectserum.com',
    weight: 8,
    rateLimit: {
      maxRequestsPerSecond: 2, 
      burstLimit: 5
    }
  },
  {
    url: 'https://rpc.ankr.com/solana',
    weight: 6,
    rateLimit: {
      maxRequestsPerSecond: 1,
      burstLimit: 3
    }
  }
  // Add more endpoints if you have access to paid RPCs
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
  // Sort by available tokens and weight
  const sortedLimiters = [...rateLimiters].sort((a, b) => {
    if (a.tokens > 0 && b.tokens === 0) return -1;
    if (a.tokens === 0 && b.tokens > 0) return 1;
    return b.weight - a.weight;
  });
  
  // Return the best endpoint
  const best = sortedLimiters[0];
  
  // If no tokens available, wait for refill
  if (best.tokens === 0) {
    const now = Date.now();
    const timeSinceRefill = (now - best.lastRefillTime) / 1000;
    const tokensToAdd = Math.floor(timeSinceRefill * best.tokenRefillRate);
    
    if (tokensToAdd > 0) {
      best.tokens = Math.min(best.maxTokens, tokensToAdd);
      best.lastRefillTime = now;
    } else {
      // Wait for token refill
      await new Promise(resolve => setTimeout(
        resolve, 
        (1 / best.tokenRefillRate) * 1000
      ));
      best.tokens = 1;
      best.lastRefillTime = Date.now();
    }
  }
  
  // Consume a token
  best.tokens--;
  
  return best.url;
}

// Export the configuration
module.exports = {
  RPC_ENDPOINTS,
  rateLimiters,
  getBestRpcEndpoint,
  httpAgent,
  httpsAgent
};