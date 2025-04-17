const https = require('https');
const crypto = require('crypto');

/**
 * Enhanced PriceFetcher class for reliable price data retrieval
 * - Multiple data sources with fallback mechanisms
 * - Caching system with configurable timeouts
 * - Robust error handling and recovery
 */
class PriceFetcher {
    constructor(tokenAddresses) {
        this.TOKEN_ADDRESSES = tokenAddresses;
        this.CACHE_DURATION = 2 * 60 * 1000; // 2 minutes cache
        this.priceCache = {};
        this.lastFetchTime = 0;
        this.fetchCount = 0;
        
        // Default token prices (used as fallback)
        this.defaultPrices = {
            'So11111111111111111111111111111111111111112': 100,  // SOL
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 1,   // USDC
            'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 1,   // USDT
            'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 105   // mSOL
        };
        
        // Data sources priority
        this.dataSources = [
            { name: 'Jupiter', method: this.fetchJupiterPrices.bind(this) },
            { name: 'CoinGecko', method: this.fetchCoinGeckoPrices.bind(this) },
            { name: 'Kucoin', method: this.fetchKucoinPrices.bind(this) }
        ];
    }

    // Robust HTTPS fetch with timeout and error handling
    httpsGetWithRetry(options, retries = 3, timeout = 10000) {
        return new Promise((resolve, reject) => {
            let attempt = 0;
            
            const makeRequest = () => {
                attempt++;
                
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
                            
                            httpsGetWithRetry(redirectOptions, retries - 1, timeout)
                                .then(resolve)
                                .catch(reject);
                            return;
                        }
                    }
                    
                    // Handle rate limiting
                    if (res.statusCode === 429) {
                        if (attempt < retries) {
                            const retryAfter = parseInt(res.headers['retry-after'] || '5', 10);
                            const delayMs = retryAfter * 1000 || (2 ** attempt * 1000);
                            
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
                                resolve(JSON.parse(data));
                            } catch (error) {
                                reject(new Error(`Failed to parse response: ${error.message}`));
                            }
                        } else {
                            reject(new Error(`HTTP error ${res.statusCode}: ${data}`));
                        }
                    });
                });

                req.on('error', (error) => {
                    if (attempt < retries) {
                        // Exponential backoff
                        const delayMs = 2 ** attempt * 1000;
                        setTimeout(() => makeRequest(), delayMs);
                    } else {
                        reject(error);
                    }
                });

                req.setTimeout(timeout, () => {
                    req.destroy();
                    if (attempt < retries) {
                        const delayMs = 2 ** attempt * 500;
                        setTimeout(() => makeRequest(), delayMs);
                    } else {
                        reject(new Error(`Request timeout after ${timeout}ms`));
                    }
                });
            };
            
            makeRequest();
        });
    }

    // Fetch prices from Jupiter Price API
    async fetchJupiterPrices() {
        try {
            console.log('Fetching prices from Jupiter API...');
            
            // Extract token addresses for the query
            const tokens = Object.values(this.TOKEN_ADDRESSES);
            const ids = tokens.join(',');
            
            const options = {
                hostname: 'price.jup.ag',
                path: `/v1/price?ids=${ids}`,
                method: 'GET'
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

            return prices;
        } catch (error) {
            console.error('Jupiter price fetch failed:', error.message);
            return null;
        }
    }

    // Fetch prices from CoinGecko API
    async fetchCoinGeckoPrices() {
        const tokenIds = {
            'So11111111111111111111111111111111111111112': 'solana',
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'usd-coin',
            'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'tether',
            'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'msol'
        };

        try {
            console.log('Fetching prices from CoinGecko API...');
            
            const ids = Object.values(tokenIds).join(',');
            const options = {
                hostname: 'api.coingecko.com',
                path: `/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            };

            const data = await this.httpsGetWithRetry(options);
            
            const prices = {};
            Object.entries(tokenIds).forEach(([address, id]) => {
                prices[address] = data[id]?.usd || this.defaultPrices[address] || 0;
            });

            return prices;
        } catch (error) {
            console.error('CoinGecko price fetch failed:', error.message);
            return null;
        }
    }

    // Fetch prices from KuCoin Exchange API
    async fetchKucoinPrices() {
        try {
            console.log('Fetching prices from KuCoin API...');
            
            const options = {
                hostname: 'api.kucoin.com',
                path: '/api/v1/market/allTickers',
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
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

            return prices;
        } catch (error) {
            console.error('KuCoin price fetch failed:', error.message);
            return null;
        }
    }

    // Fetch from alternative sources with retries - Binance API
    async fetchBinancePrices() {
        try {
            console.log('Fetching prices from Binance API...');
            
            const options = {
                hostname: 'api.binance.com',
                path: '/api/v3/ticker/price',
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            };

            const data = await this.httpsGetWithRetry(options);
            
            // Map symbols to token addresses
            const symbolMap = {
                'SOLUSDT': 'So11111111111111111111111111111111111111112',
                'USDCUSDT': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                'MSOLUSDT': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'
            };
            
            const prices = {};
            
            // Set USDT price to 1 by default
            prices['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'] = 1;
            
            // Process all other tokens
            data.forEach(item => {
                const address = symbolMap[item.symbol];
                if (address) {
                    prices[address] = parseFloat(item.price);
                }
            });
            
            // Fill in any missing prices with defaults
            Object.entries(this.TOKEN_ADDRESSES).forEach(([name, address]) => {
                if (!prices[address]) {
                    prices[address] = this.defaultPrices[address] || 0;
                }
            });

            return prices;
        } catch (error) {
            console.error('Binance price fetch failed:', error.message);
            return null;
        }
    }

    // Main method to fetch prices from all sources
    async fetchPrices() {
        console.log('Fetching token prices...');
        this.fetchCount++;
        
        // Try each data source in sequence until one works
        for (const source of this.dataSources) {
            try {
                const prices = await source.method();
                if (prices) {
                    console.log(`Successfully fetched prices from ${source.name}`);
                    return prices;
                }
            } catch (error) {
                console.error(`${source.name} price fetch error:`, error.message);
            }
        }
        
        // If all sources fail, try Binance as a last resort
        try {
            const binancePrices = await this.fetchBinancePrices();
            if (binancePrices) {
                console.log('Successfully fetched prices from Binance (fallback)');
                return binancePrices;
            }
        } catch (binanceError) {
            console.error('Binance fallback fetch error:', binanceError.message);
        }

        // If everything fails, use default prices
        console.warn('All price sources failed. Using default token prices');
        return this.defaultPrices;
    }

    // Calculate trading pair prices from token prices
    calculatePairPrices(tokenPrices, pairs) {
        const pairPrices = {};

        for (const pair of pairs) {
            const [inputToken, outputToken] = pair.split('/');
            
            const inputAddress = this.TOKEN_ADDRESSES[inputToken];
            const outputAddress = this.TOKEN_ADDRESSES[outputToken];
            
            if (!inputAddress || !outputAddress) {
                console.warn(`Invalid pair ${pair}: token address not found`);
                continue;
            }
            
            const inputPrice = tokenPrices[inputAddress] || this.defaultPrices[inputAddress] || 1;
            const outputPrice = tokenPrices[outputAddress] || this.defaultPrices[outputAddress] || 1;
            
            const pairPrice = outputPrice / inputPrice;
            
            // Generate a small spread for bid/ask simulation
            const spread = pairPrice * 0.003; // 0.3% spread
            
            pairPrices[pair] = {
                price: isFinite(pairPrice) ? pairPrice : 1,
                bid: isFinite(pairPrice) ? pairPrice - spread : 0.999,
                ask: isFinite(pairPrice) ? pairPrice + spread : 1.001,
                lastUpdate: Date.now()
            };
        }

        return pairPrices;
    }

    // Main public method to get prices with caching
    async getPrices(pairs) {
        const now = Date.now();
        
        // Check if we need to throttle API calls (max once per 15 seconds)
        const timeSinceLastFetch = now - this.lastFetchTime;
        if (this.lastFetchTime > 0 && timeSinceLastFetch < 15000) {
            console.log('Using recent price data to avoid API rate limits');
            
            // If we have cached data, use it
            if (this.priceCache.prices) {
                return this.calculatePairPrices(this.priceCache.tokenPrices, pairs);
            }
        }
        
        // Check if cache is valid
        if (this.priceCache.timestamp && 
            (now - this.priceCache.timestamp) < this.CACHE_DURATION) {
            console.log('Using cached price data');
            return this.calculatePairPrices(this.priceCache.tokenPrices, pairs);
        }
        
        // Fetch fresh prices
        const tokenPrices = await this.fetchPrices();
        
        // Update cache timestamp
        this.lastFetchTime = now;
        
        // Update cache
        this.priceCache = {
            tokenPrices,
            timestamp: now
        };
        
        return this.calculatePairPrices(tokenPrices, pairs);
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
    addDataSource(name, method, priority = 'low') {
        const newSource = { name, method };
        
        if (priority === 'high') {
            this.dataSources.unshift(newSource);
        } else {
            this.dataSources.push(newSource);
        }
    }
    
    // Clear the price cache
    clearCache() {
        this.priceCache = {};
        this.lastFetchTime = 0;
        console.log('Price cache cleared');
    }
}

module.exports = PriceFetcher;