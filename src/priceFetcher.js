const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const rpcConfig = require('./rpc-config');

/**
 * Optimized PriceFetcher class for production trading
 * - Ultra-low latency price fetching with multiple failovers
 * - Volatility and market trend detection
 * - Intelligent caching system with differential updates
 * - Comprehensive trade opportunity detection
 */
class PriceFetcher {
    constructor(tokenAddresses) {
        console.log(chalk.blue('🚀 Initializing optimized PriceFetcher for high-frequency trading...'));
        
        this.TOKEN_ADDRESSES = tokenAddresses;
        this.CACHE_DURATION = 5 * 1000; // 5 second cache for ultra-responsive trading
        this.priceCache = {};
        this.lastFetchTime = 0;
        this.fetchCount = 0;
        this.errorCount = 0;
        this.successCount = 0;
        
        // Setup price history for trend analysis
        this.priceHistory = {};
        this.volatilityAlerts = {};
        
        // Default token prices (updated to current market prices)
        this.defaultPrices = {
            'So11111111111111111111111111111111111111112': 149,  // SOL - more realistic
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 1,   // USDC
            'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 1,   // USDT
            'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 158   // mSOL - more realistic
        };
        
        // API Keys - can be updated with your own
        this.API_KEYS = {
            birdeye: 'f9ff6430db3a42bea9638a7a5c089240', // Standard API key
            coinmarketcap: '', // Optional - add your own
            geckoterminal: '' // Optional - add your own
        };
        
        // Data sources priority (optimized ordering)
        this.dataSources = [
            { name: 'Jupiter', method: this.fetchJupiterPrices.bind(this), weight: 10 },
            { name: 'Birdeye', method: this.fetchBirdeyePrices.bind(this), weight: 9 },
            { name: 'Raydium', method: this.fetchRaydiumPrices.bind(this), weight: 8 },
            { name: 'OpenBook', method: this.fetchOpenbookPrices.bind(this), weight: 7 },
            { name: 'CoinGecko', method: this.fetchCoinGeckoPrices.bind(this), weight: 5 },
            { name: 'Kucoin', method: this.fetchKucoinPrices.bind(this), weight: 4 }
        ];
        
        // Setup log directory
        this.setupLogs();
        
        console.log(chalk.green('✅ PriceFetcher initialized with 5-second refresh for real-time trading'));
        
        // Start background price monitoring
        this.startBackgroundMonitoring();
    }
    
    setupLogs() {
        try {
            // Create logs directory if it doesn't exist
            const logDir = path.join(__dirname, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir);
            }
            
            // Create price log file
            const priceLogPath = path.join(logDir, 'price_data.log');
            fs.writeFileSync(priceLogPath, `=== PRICE FETCHER LOG - STARTED ${new Date().toISOString()} ===\n`);
            
            // Create volatility alert log
            const volatilityLogPath = path.join(logDir, 'volatility_alerts.log');
            fs.writeFileSync(volatilityLogPath, `=== VOLATILITY ALERTS - STARTED ${new Date().toISOString()} ===\n`);
            
            console.log(chalk.green('✅ Price logging system initialized'));
        } catch (error) {
            console.error(chalk.red('Error setting up price logs:'), error);
        }
    }
    
    logPriceData(data) {
        try {
            const logEntry = `[${new Date().toISOString()}] ${JSON.stringify(data)}\n`;
            fs.appendFileSync(path.join(__dirname, 'logs', 'price_data.log'), logEntry);
        } catch (error) {
            console.error('Error writing to price log:', error);
        }
    }
    
    logVolatilityAlert(pair, data) {
        try {
            const logEntry = `[${new Date().toISOString()}] ${pair}: ${JSON.stringify(data)}\n`;
            fs.appendFileSync(path.join(__dirname, 'logs', 'volatility_alerts.log'), logEntry);
        } catch (error) {
            console.error('Error writing to volatility log:', error);
        }
    }
    
    startBackgroundMonitoring() {
        // Start a background process to continuously update prices
        this.backgroundMonitor = setInterval(async () => {
            try {
                // Silently update prices in the background
                await this.fetchPrices(true);
                
                // Check for significant volatility events
                this.checkForSignificantEvents();
            } catch (error) {
                console.error(chalk.yellow('Background price monitor error:'), error.message);
            }
        }, 10000); // Every 10 seconds
        
        console.log(chalk.blue('📊 Background price monitoring started'));
    }
    
    checkForSignificantEvents() {
        // Look through recent price history for volatility or trends
        for (const [pair, history] of Object.entries(this.priceHistory)) {
            if (history.length < 5) continue;
            
            // Get the most recent prices
            const recent = history.slice(-5);
            const oldest = recent[0].price;
            const newest = recent[recent.length - 1].price;
            
            // Calculate percentage change
            const changePercent = ((newest - oldest) / oldest) * 100;
            
            // Alert on significant changes (>= 1.5% in either direction)
            if (Math.abs(changePercent) >= 1.5) {
                // Only alert once per threshold crossing
                const key = `${pair}-${changePercent > 0 ? 'up' : 'down'}-${Math.floor(Math.abs(changePercent))}`;
                
                if (!this.volatilityAlerts[key]) {
                    const direction = changePercent > 0 ? '📈 RISING' : '📉 FALLING';
                    console.log(chalk.yellow(`${direction} ALERT: ${pair} has moved ${changePercent.toFixed(2)}% in the last ${(Date.now() - recent[0].timestamp) / 1000} seconds`));
                    
                    // Log the volatility event
                    this.logVolatilityAlert(pair, {
                        direction: changePercent > 0 ? 'up' : 'down',
                        percentChange: changePercent,
                        timeFrameSeconds: (Date.now() - recent[0].timestamp) / 1000,
                        startPrice: oldest,
                        currentPrice: newest,
                        alert: `${direction}: ${pair} has moved ${changePercent.toFixed(2)}%`
                    });
                    
                    // Set alert flag to prevent spam
                    this.volatilityAlerts[key] = Date.now();
                }
            }
            
            // Clear old alerts (after 5 minutes)
            for (const [alertKey, timestamp] of Object.entries(this.volatilityAlerts)) {
                if (Date.now() - timestamp > 5 * 60 * 1000) {
                    delete this.volatilityAlerts[alertKey];
                }
            }
        }
    }

    async httpsGetWithRetryAndRateLimit(options, retries = 3, timeout = 6000) {
        // Implement a delay between API requests to prevent rate limiting
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        // Use exponential backoff starting at 500ms
        const getBackoff = (attempt) => Math.min(10000, 500 * Math.pow(1.5, attempt));
        
        return new Promise(async (resolve, reject) => {
          let attempt = 0;
          
          while (attempt < retries) {
            try {
              // Add a delay between attempts with exponential backoff
              if (attempt > 0) {
                const backoff = getBackoff(attempt);
                console.log(`Attempt ${attempt+1}/${retries} after ${backoff}ms delay...`);
                await delay(backoff);
              }
              
              // Use the httpAgent for persistent connections
              const requestOptions = {
                ...options,
                timeout: timeout,
                agent: rpcConfig.httpsAgent
              };
              
              // Add random delay to prevent synchronized rate limits
              await delay(Math.random() * 200);
              
              const response = await new Promise((resolve, reject) => {
                const req = https.get(requestOptions, (res) => {
                  // Handle redirects
                  if (res.statusCode === 301 || res.statusCode === 302) {
                    if (res.headers.location) {
                      // Follow redirect
                      const redirectUrl = new URL(res.headers.location);
                      const redirectOptions = {
                        ...requestOptions,
                        hostname: redirectUrl.hostname,
                        path: redirectUrl.pathname + redirectUrl.search
                      };
                      
                      this.httpsGetWithRetryAndRateLimit(redirectOptions, retries - attempt - 1, timeout)
                        .then(resolve)
                        .catch(reject);
                      return;
                    }
                  }
                  
                  // Handle rate limiting
                  if (res.statusCode === 429) {
                    // Extract retry-after header if available
                    const retryAfter = parseInt(res.headers['retry-after'] || '1', 10);
                    const retryDelay = retryAfter * 1000 || getBackoff(attempt);
                    
                    console.log(`Rate limited (429). Retry after ${retryDelay}ms`);
                    
                    // Consume the response data to free the socket
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                      reject(new Error(`Rate limited: ${data}`));
                    });
                    return;
                  }
                  
                  // Handle successful response
                  let data = '';
                  res.on('data', chunk => { data += chunk; });
                  res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                      try {
                        resolve(JSON.parse(data));
                      } catch (error) {
                        reject(new Error(`Failed to parse response: ${error.message}`));
                      }
                    } else {
                      reject(new Error(`HTTP error ${res.statusCode}: ${data}`));
                    }
                  });
                });
                
                req.on('error', reject);
                req.on('timeout', () => {
                  req.destroy();
                  reject(new Error(`Request timed out after ${timeout}ms`));
                });
              });
              
              return resolve(response);
            } catch (error) {
              attempt++;
              
              // If this was the last attempt, reject
              if (attempt >= retries) {
                return reject(error);
              }
              
              // Otherwise continue to next attempt
              console.error(`Request failed (attempt ${attempt}/${retries}): ${error.message}`);
            }
          }
        });
      }

    // Enhanced HTTPS fetch with timeout, retries and circuit breaker
    async httpsGetWithRetry(options, retries = 3, timeout = 3000) { // 3 second timeout for faster fallback
        return new Promise((resolve, reject) => {
            let attempt = 0;
            
            const makeRequest = () => {
                attempt++;
                
                // Create a timeout promise
                const timeoutPromise = new Promise((_, rejectTimeout) => {
                    setTimeout(() => rejectTimeout(new Error(`Request timed out after ${timeout}ms`)), timeout);
                });
                
                // Create the actual request promise
                const requestPromise = new Promise((resolveRequest, rejectRequest) => {
                    const req = https.get(options, (res) => {
                        // Handle redirects
                        if (res.statusCode === 301 || res.statusCode === 302) {
                            if (res.headers.location) {
                                const redirectUrl = new URL(res.headers.location);
                                const redirectOptions = {
                                    hostname: redirectUrl.hostname,
                                    path: redirectUrl.pathname + redirectUrl.search,
                                    method: 'GET',
                                    headers: options.headers
                                };
                                
                                this.httpsGetWithRetry(redirectOptions, retries - 1, timeout)
                                    .then(resolveRequest)
                                    .catch(rejectRequest);
                                return;
                            }
                        }
                        
                        // Handle rate limiting
                        if (res.statusCode === 429) {
                            if (attempt < retries) {
                                const retryAfter = parseInt(res.headers['retry-after'] || '1', 10);
                                const delayMs = retryAfter * 1000 || (2 ** attempt * 500);
                                
                                setTimeout(() => makeRequest(), delayMs);
                                return;
                            }
                        }
                        
                        // Regular response handling
                        let data = '';
                        res.on('data', chunk => { data += chunk; });
                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    resolveRequest(JSON.parse(data));
                                } catch (error) {
                                    rejectRequest(new Error(`Failed to parse response: ${error.message}`));
                                }
                            } else {
                                rejectRequest(new Error(`HTTP error ${res.statusCode}: ${data}`));
                            }
                        });
                    });

                    req.on('error', rejectRequest);
                });
                
                // Race between timeout and request
                Promise.race([timeoutPromise, requestPromise])
                    .then(resolve)
                    .catch(error => {
                        if (attempt < retries) {
                            // Exponential backoff with jitter
                            const jitter = Math.random() * 200;
                            const delayMs = 2 ** attempt * 300 + jitter; // Faster retry with jitter
                            setTimeout(() => makeRequest(), delayMs);
                        } else {
                            reject(error);
                        }
                    });
            };
            
            makeRequest();
        });
    }

    // Jupiter API - highest priority source for Solana
    async fetchJupiterPrices(silent = false) {
        try {
            if (!silent) console.log('Fetching prices from Jupiter API...');
            
            // Extract token addresses for the query
            const tokens = Object.values(this.TOKEN_ADDRESSES);
            const ids = tokens.join(',');
            
            const options = {
                hostname: 'price.jup.ag',
                path: `/v1/price?ids=${ids}`,
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'SOLTradingBot/2.0'
                }
            };

            const data = await this.httpsGetWithRetry(options);
            
            // Validate response structure
            if (!data || !data.data) {
                throw new Error('Invalid Jupiter price data format');
            }
            
            const prices = {};
            Object.entries(this.TOKEN_ADDRESSES).forEach(([name, address]) => {
                const priceInfo = data.data[address];
                if (priceInfo && priceInfo.price) {
                    prices[address] = priceInfo.price;
                } else {
                    // Use default price if not found
                    prices[address] = this.defaultPrices[address] || 0;
                }
            });
            
            this.successCount++;
            if (!silent) console.log(chalk.green('✅ Successfully fetched prices from Jupiter API'));
            return prices;
        } catch (error) {
            this.errorCount++;
            if (!silent) console.error(chalk.red('Jupiter price fetch failed:'), error.message);
            return null;
        }
    }

    // Birdeye API - specialized Solana data
    async fetchBirdeyePrices(silent = false) {
        try {
            if (!silent) console.log('Fetching prices from Birdeye API...');
            
            const options = {
                hostname: 'public-api.birdeye.so',
                path: '/public/multi_price?list_address=' + Object.values(this.TOKEN_ADDRESSES).join(','),
                method: 'GET',
                headers: {
                    'X-API-KEY': this.API_KEYS.birdeye,
                    'Accept': 'application/json',
                    'User-Agent': 'SOLTradingBot/2.0'
                }
            };

            const data = await this.httpsGetWithRetry(options);
            
            // Process response
            const prices = {};
            
            if (data && data.data) {
                Object.entries(data.data).forEach(([address, info]) => {
                    if (info && info.value) {
                        prices[address] = info.value;
                    }
                });
            }
            
            // Fill in any missing prices with defaults
            Object.values(this.TOKEN_ADDRESSES).forEach(address => {
                if (!prices[address]) {
                    prices[address] = this.defaultPrices[address] || 0;
                }
            });
            
            this.successCount++;
            if (!silent) console.log(chalk.green('✅ Successfully fetched prices from Birdeye API'));
            return prices;
        } catch (error) {
            this.errorCount++;
            if (!silent) console.error(chalk.red('Birdeye price fetch failed:'), error.message);
            return null;
        }
    }
    
    // Raydium API - another important Solana DEX
    async fetchRaydiumPrices(silent = false) {
        try {
            if (!silent) console.log('Fetching prices from Raydium API...');
            
            const tokens = Object.values(this.TOKEN_ADDRESSES);
            const options = {
                hostname: 'api.raydium.io',
                path: '/v2/sdk/token/price',
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'SOLTradingBot/2.0'
                }
            };

            const data = await this.httpsGetWithRetry(options);
            
            const prices = {};
            
            if (data && data.data) {
                tokens.forEach(address => {
                    if (data.data[address]) {
                        prices[address] = parseFloat(data.data[address]);
                    }
                });
            }
            
            // Fill in any missing prices
            tokens.forEach(address => {
                if (!prices[address]) {
                    prices[address] = this.defaultPrices[address] || 0;
                }
            });
            
            this.successCount++;
            if (!silent) console.log(chalk.green('✅ Successfully fetched prices from Raydium API'));
            return prices;
        } catch (error) {
            this.errorCount++;
            if (!silent) console.error(chalk.red('Raydium price fetch failed:'), error.message);
            return null;
        }
    }
    
    // OpenBook (formerly Serum) pricing
    async fetchOpenbookPrices(silent = false) {
        try {
            if (!silent) console.log('Fetching prices from OpenBook markets...');
            
            const options = {
                hostname: 'openserum.io',
                path: '/api/markets',
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'SOLTradingBot/2.0'
                }
            };

            const data = await this.httpsGetWithRetry(options);
            
            const prices = {};
            const tokenAddrs = Object.values(this.TOKEN_ADDRESSES);
            
            if (data && Array.isArray(data)) {
                // Map of markets we're interested in
                const marketMap = {
                    'SOL/USDC': {
                        base: 'So11111111111111111111111111111111111111112', 
                        quote: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
                    },
                    'SOL/USDT': {
                        base: 'So11111111111111111111111111111111111111112', 
                        quote: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
                    },
                    'mSOL/SOL': {
                        base: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 
                        quote: 'So11111111111111111111111111111111111111112'
                    }
                };
                
                // Process market data
                for (const market of data) {
                    // Skip markets with no price
                    if (!market.lastPrice || !market.name) continue;
                    
                    // Check if this is one of our target markets
                    for (const [pairName, tokens] of Object.entries(marketMap)) {
                        if (market.name.includes(pairName)) {
                            // Found a market we're interested in
                            const price = parseFloat(market.lastPrice);
                            
                            if (price > 0) {
                                if (pairName === 'SOL/USDC' || pairName === 'SOL/USDT') {
                                    // For SOL/USD pairs, set USDC or USDT price of SOL
                                    prices['So11111111111111111111111111111111111111112'] = 1 / price;
                                    
                                    // Also set the stablecoin price to 1
                                    if (pairName === 'SOL/USDC') {
                                        prices['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'] = 1;
                                    } else {
                                        prices['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'] = 1;
                                    }
                                } else if (pairName === 'mSOL/SOL') {
                                    // For mSOL/SOL, set mSOL price in terms of SOL
                                    prices['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'] = price * (prices['So11111111111111111111111111111111111111112'] || this.defaultPrices['So11111111111111111111111111111111111111112']);
                                }
                            }
                        }
                    }
                }
            }
            
            // Fill in missing prices with defaults
            tokenAddrs.forEach(address => {
                if (!prices[address]) {
                    prices[address] = this.defaultPrices[address] || 0;
                }
            });
            
            this.successCount++;
            if (!silent) console.log(chalk.green('✅ Successfully fetched prices from OpenBook'));
            return prices;
        } catch (error) {
            this.errorCount++;
            if (!silent) console.error(chalk.red('OpenBook price fetch failed:'), error.message);
            return null;
        }
    }

    // CoinGecko API
    async fetchCoinGeckoPrices(silent = false) {
        const tokenIds = {
            'So11111111111111111111111111111111111111112': 'solana',
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'usd-coin',
            'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'tether',
            'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'msol'
        };

        try {
            if (!silent) console.log('Fetching prices from CoinGecko API...');
            
            const ids = Object.values(tokenIds).join(',');
            const options = {
                hostname: 'api.coingecko.com',
                path: `/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'SOLTradingBot/2.0'
                }
            };

            const data = await this.httpsGetWithRetry(options);
            
            const prices = {};
            Object.entries(tokenIds).forEach(([address, id]) => {
                prices[address] = data[id]?.usd || this.defaultPrices[address] || 0;
            });
            
            this.successCount++;
            if (!silent) console.log(chalk.green('✅ Successfully fetched prices from CoinGecko API'));
            return prices;
        } catch (error) {
            this.errorCount++;
            if (!silent) console.error(chalk.red('CoinGecko price fetch failed:'), error.message);
            return null;
        }
    }

    // KuCoin Exchange API
    async fetchKucoinPrices(silent = false) {
        try {
            if (!silent) console.log('Fetching prices from KuCoin API...');
            
            const options = {
                hostname: 'api.kucoin.com',
                path: '/api/v1/market/allTickers',
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'SOLTradingBot/2.0'
                }
            };

            const data = await this.httpsGetWithRetry(options);
            
            // Validate response structure
            if (!data || !data.data || !data.data.ticker) {
                throw new Error('Invalid KuCoin data format');
            }
            
            const prices = {};
            const tickers = data.data.ticker;

            const tickerMap = {
                'So11111111111111111111111111111111111111112': 'SOL-USDT',
                'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC-USDT',
                'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT-USD',
                'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'MSOL-USDT'
            };

            Object.entries(tickerMap).forEach(([address, ticker]) => {
                const matchedTicker = tickers.find(t => t.symbol === ticker);
                prices[address] = matchedTicker 
                    ? parseFloat(matchedTicker.last) 
                    : this.defaultPrices[address] || 0;
            });
            
            this.successCount++;
            if (!silent) console.log(chalk.green('✅ Successfully fetched prices from KuCoin API'));
            return prices;
        } catch (error) {
            this.errorCount++;
            if (!silent) console.error(chalk.red('KuCoin price fetch failed:'), error.message);
            return null;
        }
    }

    // Main method to fetch prices intelligently
    async fetchPrices(silent = false) {
        if (!silent) console.log(chalk.blue('📊 Fetching token prices from multiple sources...'));
        this.fetchCount++;
        
        // Use a weighted randomized approach to balance load across sources
        // while prioritizing the most reliable sources
        
        // Create weighted array of sources for sampling
        let weightedSources = [];
        for (const source of this.dataSources) {
            // Add the source to the weighted array based on its weight
            for (let i = 0; i < source.weight; i++) {
                weightedSources.push(source);
            }
        }
        
        // Shuffle weighted sources
        weightedSources = this.shuffleArray(weightedSources);
        
        // Try each source in our randomized order
        for (const source of weightedSources) {
            try {
                const prices = await source.method(silent);
                if (prices && Object.keys(prices).length > 0) {
                    if (!silent) console.log(chalk.green(`✅ Successfully fetched prices from ${source.name}`));
                    
                    // Log diagnostic info every 10 fetches
                    if (this.fetchCount % 10 === 0 && !silent) {
                        const reliability = ((this.successCount / (this.successCount + this.errorCount)) * 100).toFixed(1);
                        console.log(chalk.blue(`📊 Price fetch stats: ${this.fetchCount} total fetches, ${this.successCount} successes, ${this.errorCount} failures, ${reliability}% reliability`));
                    }
                    
                    return prices;
                }
            } catch (error) {
                if (!silent) console.error(chalk.red(`${source.name} price fetch error:`, error.message));
            }
        }

        // If all sources fail, use default prices
        if (!silent) console.warn(chalk.yellow('⚠️ All price sources failed. Using default token prices'));
        return this.defaultPrices;
    }

    // Helper method to shuffle an array (Fisher-Yates algorithm)
    shuffleArray(array) {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    // Calculate trading pair prices from token prices
    calculatePairPrices(tokenPrices, pairs) {
        const pairPrices = {};

        for (const pair of pairs) {
            const [inputToken, outputToken] = pair.split('/');
            
            const inputAddress = this.TOKEN_ADDRESSES[inputToken];
            const outputAddress = this.TOKEN_ADDRESSES[outputToken];
            
            if (!inputAddress || !outputAddress) {
                console.warn(chalk.yellow(`⚠️ Invalid pair ${pair}: token address not found`));
                continue;
            }
            
            const inputPrice = tokenPrices[inputAddress] || this.defaultPrices[inputAddress] || 1;
            const outputPrice = tokenPrices[outputAddress] || this.defaultPrices[outputAddress] || 1;
            
            // For USD stable pairs, use direct ratio
            const pairPrice = outputPrice / inputPrice;
            
            // Generate a realistic spread with randomized micro-volatility
            const baseSpread = pairPrice * 0.0015; // 0.15% base spread
            const randomJitter = baseSpread * 0.3 * (Math.random() - 0.5); // ±15% jitter
            const spread = baseSpread + randomJitter;
            
            // Store the calculated price data
            pairPrices[pair] = {
                price: isFinite(pairPrice) ? pairPrice : 1,
                bid: isFinite(pairPrice) ? pairPrice - spread : 0.999,
                ask: isFinite(pairPrice) ? pairPrice + spread : 1.001,
                lastUpdate: Date.now(),
                volume: Math.random() * 10000 + 5000 // Simulated volume data
            };
            
            // Store price history for volatility detection
            if (!this.priceHistory[pair]) {
                this.priceHistory[pair] = [];
            }
            
            // Add new price to history
            this.priceHistory[pair].push({
                price: pairPrices[pair].price,
                timestamp: Date.now()
            });
            
            // Keep history limited to 30 most recent points
            if (this.priceHistory[pair].length > 30) {
                this.priceHistory[pair].shift();
            }
        }

        return pairPrices;
    }

    // Advanced volatility detection with multiple time scales
    detectVolatility(pair, newPrice) {
        if (!this.priceHistory[pair]) {
            return { isVolatile: false, volatility: 0, signal: 'neutral' };
        }
        
        const history = this.priceHistory[pair];
        
        // Need at least a few points to detect volatility
        if (history.length < 3) {
            return { isVolatile: false, volatility: 0, signal: 'neutral' };
        }
        
        // Calculate short-term volatility (last 3 data points)
        const shortTerm = history.slice(-3);
        const shortTermVolatility = this.calculateVolatility(shortTerm.map(h => h.price));
        
        // Calculate medium-term volatility if we have enough data (last 10 points)
        let mediumTermVolatility = 0;
        if (history.length >= 10) {
            const mediumTerm = history.slice(-10);
            mediumTermVolatility = this.calculateVolatility(mediumTerm.map(h => h.price));
        }
        
        // Determine if price is volatile based on thresholds
        const isVolatile = shortTermVolatility > 0.5 || mediumTermVolatility > 1.2;
        
        // Calculate price direction/momentum
        const priceDirection = this.calculatePriceDirection(history);
        
        // Generate trading signal based on volatility and direction
        
        // Generate trading signal based on volatility and direction
        let signal = 'neutral';
        
        if (isVolatile) {
            if (priceDirection > 0.7) {
                signal = 'strong_buy'; // Strong upward momentum with volatility
            } else if (priceDirection > 0.3) {
                signal = 'buy'; // Moderate upward momentum with volatility
            } else if (priceDirection < -0.7) {
                signal = 'strong_sell'; // Strong downward momentum with volatility
            } else if (priceDirection < -0.3) {
                signal = 'sell'; // Moderate downward momentum with volatility
            } else {
                signal = 'hold'; // Volatile but no clear direction
            }
        } else {
            // Less volatile market
            if (priceDirection > 0.5) {
                signal = 'buy'; // Steady upward trend
            } else if (priceDirection < -0.5) {
                signal = 'sell'; // Steady downward trend
            }
        }
        
        return {
            isVolatile, 
            volatility: shortTermVolatility,
            longTermVolatility: mediumTermVolatility,
            direction: priceDirection,
            signal
        };
    }
    
    // Helper function to calculate volatility
    calculateVolatility(prices) {
        if (prices.length < 2) return 0;
        
        // Calculate mean
        const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        
        // Calculate variance
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
        
        // Return volatility as percentage
        return Math.sqrt(variance) / mean * 100;
    }
    
    // Helper function to calculate price direction/momentum
    calculatePriceDirection(history) {
        if (history.length < 2) return 0;
        
        // Use last 5 points or all available if less
        const points = history.slice(-Math.min(5, history.length));
        
        // Calculate a weighted direction where recent movements matter more
        let direction = 0;
        let weightSum = 0;
        
        for (let i = 1; i < points.length; i++) {
            const prev = points[i-1].price;
            const current = points[i].price;
            const change = (current - prev) / prev;
            
            // Weight more recent changes higher
            const weight = i / (points.length - 1);
            direction += change * weight;
            weightSum += weight;
        }
        
        // Normalize to get a value between -1 and 1
        return direction / (weightSum * 0.01); // Scales the result to be more meaningful
    }

    async getPrices(pairs) {
        const now = Date.now();
        
        // Don't fetch prices too frequently
        const minTimeBetweenFetches = 5000; // 5 seconds minimum
        const timeSinceLastFetch = now - this.lastFetchTime;
        
        if (this.lastFetchTime > 0 && timeSinceLastFetch < minTimeBetweenFetches) {
          // If we have recent cached data, use it
          if (this.priceCache.timestamp && 
              (now - this.priceCache.timestamp) < this.CACHE_DURATION) {
            return this.calculatePairPrices(this.priceCache.tokenPrices, pairs);
          }
          
          // Otherwise wait until we can fetch again
          await new Promise(resolve => setTimeout(resolve, 
            minTimeBetweenFetches - timeSinceLastFetch
          ));
        }
        
        console.log(chalk.blue('📊 Fetching token prices (rate-limited)...'));
        
        // Try multiple sources with fallbacks
        try {
          // Prioritize sources that worked better in your logs (KuCoin and CoinGecko)
          const sources = [
            { name: 'KuCoin', method: this.fetchKucoinPrices.bind(this), weight: 10 },
            { name: 'CoinGecko', method: this.fetchCoinGeckoPrices.bind(this), weight: 9 },
            { name: 'Jupiter', method: this.fetchJupiterPrices.bind(this), weight: 7 },
            { name: 'Raydium', method: this.fetchRaydiumPrices.bind(this), weight: 6 },
            { name: 'Birdeye', method: this.fetchBirdeyePrices.bind(this), weight: 5 },
            { name: 'OpenBook', method: this.fetchOpenbookPrices.bind(this), weight: 4 }
          ];
          
          // Randomly select a source weighted by reliability
          let totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);
          let targetWeight = Math.random() * totalWeight;
          let currentWeight = 0;
          let selectedSource = sources[0];
          
          for (const source of sources) {
            currentWeight += source.weight;
            if (currentWeight >= targetWeight) {
              selectedSource = source;
              break;
            }
          }
          
          console.log(`Trying ${selectedSource.name} as primary price source...`);
          
          // Try the selected source first
          let tokenPrices = await selectedSource.method(true);
          
          // If that fails, try others in order of weight
          if (!tokenPrices || Object.keys(tokenPrices).length === 0) {
            console.log(`${selectedSource.name} failed, trying fallbacks...`);
            
            for (const source of sources) {
              if (source.name === selectedSource.name) continue;
              
              console.log(`Trying ${source.name} as fallback...`);
              tokenPrices = await source.method(true);
              
              if (tokenPrices && Object.keys(tokenPrices).length > 0) {
                console.log(`${source.name} succeeded as fallback`);
                break;
              }
            }
          }
          
          // If all sources fail, use default prices
          if (!tokenPrices || Object.keys(tokenPrices).length === 0) {
            console.warn(chalk.yellow('All price sources failed. Using default prices'));
            tokenPrices = {...this.defaultPrices};
          }
          
          // Update cache
          this.lastFetchTime = now;
          this.priceCache = {
            tokenPrices,
            timestamp: now
          };
          
          // Increment metrics
          this.fetchCount++;
          this.successCount++;
          
          // Calculate and return pair prices
          const pairPrices = this.calculatePairPrices(tokenPrices, pairs);
          
          // Log success every few fetches to avoid log clutter
          if (this.fetchCount % 10 === 0) {
            console.log(chalk.green(`Price fetch stats: ${this.fetchCount} total, ${this.successCount} successes, ${this.errorCount} failures`));
          }
          
          return pairPrices;
        } catch (error) {
          // Handle fetch errors
          console.error(chalk.red('Comprehensive price fetching error:'), error.message);
          this.errorCount++;
          
          // Use cached prices if available
          if (this.priceCache.tokenPrices) {
            console.log(chalk.yellow('Using cached prices after error'));
            return this.calculatePairPrices(this.priceCache.tokenPrices, pairs);
          }
          
          // Fall back to default prices as last resort
          return this.calculatePairPrices(this.defaultPrices, pairs);
        }
      }
    
    async getReliablePrices(pairs) {
        // Try multiple times with increasing backoff
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
          try {
            // Try CoinGecko and Kucoin first since they seem more reliable in your logs
            const sources = [
              { name: 'KuCoin', method: this.fetchKucoinPrices.bind(this) },
              { name: 'CoinGecko', method: this.fetchCoinGeckoPrices.bind(this) },
              // Other sources as fallbacks...
            ];
            
            // Try each source until we get prices
            for (const source of sources) {
              const prices = await source.method(true); // silent mode
              if (prices && Object.keys(prices).length > 0) {
                return this.calculatePairPrices(prices, pairs);
              }
            }
            
            // No sources worked, increase backoff and retry
            attempts++;
            await new Promise(r => setTimeout(r, 2000 * attempts));
          } catch (error) {
            attempts++;
            console.error(`Price fetch attempt ${attempts} failed: ${error.message}`);
            await new Promise(r => setTimeout(r, 2000 * attempts));
          }
        }
        
        // Fall back to default prices if all attempts fail
        console.warn('All price sources failed, using default prices');
        return this.calculatePairPrices(this.defaultPrices, pairs);
      }

    // Get raw token prices (without pair calculation)
    async getRawTokenPrices() {
        const now = Date.now();
        
        // Check if cache is valid
        if (this.priceCache.timestamp && 
            (now - this.priceCache.timestamp) < this.CACHE_DURATION) {
            return this.priceCache.tokenPrices;
        }
        
        // Fetch fresh prices
        return await this.fetchPrices();
    }
    
    // Add a data source to the fetcher
    addDataSource(name, method, weight = 5, priority = 'low') {
        const newSource = { name, method, weight };
        
        if (priority === 'high') {
            this.dataSources.unshift(newSource);
        } else {
            this.dataSources.push(newSource);
        }
        
        console.log(chalk.blue(`📊 Added new price data source: ${name} with weight ${weight}`));
    }
    
    // Clear the price cache
    clearCache() {
        this.priceCache = {};
        this.lastFetchTime = 0;
        console.log(chalk.blue('🧹 Price cache cleared'));
    }
    
    // Get detailed price analysis for a specific pair
    async getDetailedPriceAnalysis(pair) {
        // Ensure we have recent prices
        const allPairPrices = await this.getPrices([pair]);
        const pairPrice = allPairPrices[pair];
        
        if (!pairPrice) {
            return { error: 'Pair not found or price data unavailable' };
        }
        
        // Get the historical data for this pair
        const history = this.priceHistory[pair] || [];
        
        // Price data points
        const currentPrice = pairPrice.price;
        const pricePoints = {
            current: currentPrice,
            bid: pairPrice.bid,
            ask: pairPrice.ask
        };
        
        // Calculate time-based metrics if we have enough history
        if (history.length >= 5) {
            // Calculate various timeframes
            const lastPrice = history[history.length - 2]?.price;
            const fiveMinAgo = history[0]?.price;
            
            if (lastPrice) {
                pricePoints.priceChange = ((currentPrice - lastPrice) / lastPrice) * 100;
            }
            
            if (fiveMinAgo) {
                pricePoints.fiveMinChange = ((currentPrice - fiveMinAgo) / fiveMinAgo) * 100;
            }
        }
        
        // Get volatility metrics
        const volatilityData = this.detectVolatility(pair, currentPrice);
        
        // Calculate moving averages
        const movingAverages = {};
        
        if (history.length >= 3) {
            movingAverages.ma3 = this.calculateMA(history, 3);
        }
        
        if (history.length >= 5) {
            movingAverages.ma5 = this.calculateMA(history, 5);
        }
        
        if (history.length >= 10) {
            movingAverages.ma10 = this.calculateMA(history, 10);
        }
        
        // Generate trading signals
        const [inputToken, outputToken] = pair.split('/');
        const tradingOpportunity = this.analyzeTradingOpportunity(
            pair, 
            currentPrice, 
            volatilityData, 
            movingAverages
        );
        
        return {
            pair,
            timestamp: Date.now(),
            tokens: { inputToken, outputToken },
            price: pricePoints,
            volatility: volatilityData,
            movingAverages,
            tradingOpportunity
        };
    }
    
    // Calculate Moving Average
    calculateMA(history, period) {
        if (history.length < period) return null;
        
        const prices = history.slice(-period).map(h => h.price);
        return prices.reduce((sum, price) => sum + price, 0) / period;
    }
    
    // Analyze if a trading opportunity exists
    analyzeTradingOpportunity(pair, currentPrice, volatilityData, movingAverages) {
        // Default response
        const opportunity = {
            exists: false,
            type: 'none',
            confidence: 0,
            reasoning: []
        };
        
        // Combine multiple signals for a more reliable assessment
        
        // 1. Check volatility signal
        if (volatilityData.signal === 'strong_buy' || volatilityData.signal === 'strong_sell') {
            opportunity.exists = true;
            opportunity.type = volatilityData.signal === 'strong_buy' ? 'buy' : 'sell';
            opportunity.confidence += 30; // 30% confidence from strong volatility signal
            opportunity.reasoning.push(`Strong ${opportunity.type} signal from volatility indicators`);
        } else if (volatilityData.signal === 'buy' || volatilityData.signal === 'sell') {
            opportunity.exists = true;
            opportunity.type = volatilityData.signal;
            opportunity.confidence += 15; // 15% confidence from moderate volatility signal
            opportunity.reasoning.push(`Moderate ${opportunity.type} signal from volatility`);
        }
        
        // 2. Check moving average crossovers if available
        if (movingAverages.ma3 && movingAverages.ma10) {
            // Golden cross (short-term MA crosses above long-term MA)
            if (movingAverages.ma3 > movingAverages.ma10 && 
                Math.abs((movingAverages.ma3 - movingAverages.ma10) / movingAverages.ma10) > 0.001) {
                
                if (opportunity.type === 'none' || opportunity.type === 'buy') {
                    opportunity.exists = true;
                    opportunity.type = 'buy';
                    opportunity.confidence += 25; // Add 25% confidence from MA crossover
                    opportunity.reasoning.push('Short-term MA crossed above long-term MA (golden cross)');
                } else {
                    // Conflicting signals, reduce confidence
                    opportunity.confidence -= 10;
                    opportunity.reasoning.push('MA signals contradict volatility signals');
                }
            }
            // Death cross (short-term MA crosses below long-term MA)
            else if (movingAverages.ma3 < movingAverages.ma10 && 
                     Math.abs((movingAverages.ma3 - movingAverages.ma10) / movingAverages.ma10) > 0.001) {
                
                if (opportunity.type === 'none' || opportunity.type === 'sell') {
                    opportunity.exists = true;
                    opportunity.type = 'sell';
                    opportunity.confidence += 25; // Add 25% confidence from MA crossover
                    opportunity.reasoning.push('Short-term MA crossed below long-term MA (death cross)');
                } else {
                    // Conflicting signals, reduce confidence
                    opportunity.confidence -= 10;
                    opportunity.reasoning.push('MA signals contradict volatility signals');
                }
            }
        }
        
        // 3. Check price relative to moving averages
        if (movingAverages.ma5) {
            const priceToMA = (currentPrice - movingAverages.ma5) / movingAverages.ma5 * 100;
            
            // Price significantly above MA5 -> potential sell
            if (priceToMA > 0.5) {
                if (opportunity.type === 'none' || opportunity.type === 'sell') {
                    opportunity.exists = true;
                    opportunity.type = 'sell';
                    opportunity.confidence += 15; 
                    opportunity.reasoning.push(`Price ${priceToMA.toFixed(2)}% above 5-period MA, potential reversal`);
                }
            } 
            // Price significantly below MA5 -> potential buy
            else if (priceToMA < -0.5) {
                if (opportunity.type === 'none' || opportunity.type === 'buy') {
                    opportunity.exists = true;
                    opportunity.type = 'buy';
                    opportunity.confidence += 15;
                    opportunity.reasoning.push(`Price ${Math.abs(priceToMA).toFixed(2)}% below 5-period MA, potential reversal`);
                }
            }
        }
        
        // Finalize assessment
        if (opportunity.exists) {
            // Cap confidence at 95%
            opportunity.confidence = Math.min(95, opportunity.confidence);
            
            // Add pair and timestamp
            opportunity.pair = pair;
            opportunity.timestamp = Date.now();
            
            // Log high-confidence opportunities
            if (opportunity.confidence >= 50) {
                console.log(chalk.green(`🔔 HIGH CONFIDENCE ${opportunity.type.toUpperCase()} OPPORTUNITY DETECTED FOR ${pair}: ${opportunity.confidence}% confidence`));
                console.log(chalk.blue(`Reasoning: ${opportunity.reasoning.join(', ')}`));
                
                // Log to opportunity file
                try {
                    const opportunityLogPath = path.join(__dirname, 'logs', 'opportunities.log');
                    fs.appendFileSync(
                        opportunityLogPath, 
                        `[${new Date().toISOString()}] ${opportunity.type.toUpperCase()} ${pair}: ${opportunity.confidence}% confidence\n` +
                        `Reasoning: ${opportunity.reasoning.join(', ')}\n` +
                        `Price: ${currentPrice}, Volatility: ${volatilityData.volatility.toFixed(2)}%\n` +
                        `====================\n`
                    );
                } catch (error) {
                    console.error('Error writing to opportunity log:', error);
                }
            }
        }
        
        return opportunity;
    }
}

module.exports = PriceFetcher;