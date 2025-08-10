/**
 * tokens-config.js
 * Comprehensive token configurations for Solana Trading Bot
 * Contains token addresses, decimals, and trading pair configurations
 */

// Token address mappings
const TOKEN_ADDRESSES = {
    // Major tokens
    'SOL': 'So11111111111111111111111111111111111111112', // Wrapped SOL
    'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    'BTC': '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', // Wrapped BTC
    'ETH': '2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk', // Wrapped ETH
    
    // Solana ecosystem tokens
    'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // Raydium
    'SRM': 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt', // Serum
    'mSOL': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // Marinade Staked SOL
    'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // Bonk
    'JTO': 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9XCE', // Jito
    'JLP': 'JPLPXipaDXdZJkGxYjYbj9mh1n5JnQvXBFkLx5aDKMPz', // Jito Liquid Staking
    'SAMO': '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', // Samoyedcoin
    'ORCA': 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', // Orca
    'ATLAS': 'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx', // Star Atlas
    'POLIS': 'poLisWXnNRwC6oBu1vHiuKQzFjGL4XDSu4g9qjz9qVk', // Star Atlas DAO
    
    // More Solana tokens
    'MEAN': 'MEANeD3XDdUmNMsRGjASkSWdC8prLYsoRJ61pPeHctD', // Mean DAO
    'DUST': 'DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ', // DUST Protocol
    'SHDW': 'SHDWyBxihqiCj6YekG2GUr7wqKLeLAMK1gHZck9pL6y', // GenesysGo Shadow
    'BERN': 'BERNKmPBXUfPYqEFRxFMSzPt4gECBhTDRJqWJSHpKKQW', // Bern
    'PORT': 'PoRTjZMPXb9T7dyU7tpLEZRQj7e6ssfAE62j2oQuc6y', // Port Finance
    'MNGO': 'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac', // Mango Markets
    'GENE': 'GENEtH5amGSi8kHAtQoezp1XEXwZJ8vcuePYnXdKrMYz', // Genopets
    'SNY': '4dmKkXNHdgYsXqBHCuMikNQWwVomZURhYvkkX5c4pQ7y', // Synthetify
    'AUDIO': '9LMQSbpRX8eh3eHzxu5jfCvkJwLnRgiLV5oQVMynqqhH', // Audius
    'HADES': 'BWXrrYFHxTvjmCgPcJZZuPNV3eFx7XMRHDcX4ttCWRqM', // Hades by Helium
    'RENDER': 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T6rcqyPZhGn2', // Render Network
    'PYTH': '4CkQJBxhU8EZ2UjhigbtdaPbpTe6mqf811fipYBFbSYN', // Pyth Network
    'SC': 'ScMggE5wYs85XzTrZBVRyxy1dh3xcCJjjpz6f5RCzVi', // Serum Surfers
    'LVL': 'LVLogicpG95HyKy1WCPbC3rB1QWVBs3WZ9JERTgcnBaJ', // LVL Finance
    'BLUR': 'BLURVbWGofP27AxVwgELBzEMJGGRtXgzYG1XGkSoRHdz', // Blur Finance
    'STEP': 'StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT', // Step Finance
    'GST': 'AFbX8oGjGpmVFywbVouvhQSRmiW2aR1mohfahi4Y2AdB', // STEPN GST
    'GMT': '7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx', // STEPN GMT
};

// Token decimal places for conversion
const TOKEN_DECIMALS = {
    // Main tokens
    'SOL': 9,
    'USDC': 6,
    'USDT': 6,
    'BTC': 8,
    'ETH': 8,
    'mSOL': 9,
    
    // Ecosystem tokens
    'RAY': 6,
    'SRM': 6,
    'BONK': 5,
    'JTO': 9,
    'JLP': 9,
    'SAMO': 9,
    'ORCA': 6,
    'ATLAS': 8,
    'POLIS': 8,
    
    // Additional tokens
    'MEAN': 6,
    'DUST': 9,
    'SHDW': 6,
    'BERN': 9,
    'PORT': 6,
    'MNGO': 6,
    'GENE': 9,
    'SNY': 6,
    'AUDIO': 8,
    'HADES': 9,
    'RENDER': 8,
    'PYTH': 6,
    'SC': 9,
    'LVL': 6,
    'BLUR': 8,
    'STEP': 9,
    'GST': 9,
    'GMT': 9,
    
    // Default for any token not explicitly defined
    'DEFAULT': 9
};

// Trading pair configurations
// Organized by liquidity tiers for optimal strategy selection
const TRADING_PAIRS = {
    // Tier 1: Highest liquidity pairs (core focus)
    highLiquidity: [
        'SOL/USDC',
        'SOL/USDT',
        'USDC/SOL',
        'USDT/SOL',
        'BTC/USDC',
        'ETH/USDC',
        'mSOL/SOL',
        'SOL/mSOL'
    ],
    
    // Tier 2: Medium liquidity pairs (good opportunities)
    mediumLiquidity: [
        'BONK/USDC',
        'JTO/USDC',
        'RAY/USDC',
        'ORCA/USDC',
        'SAMO/USDC',
        'BTC/SOL',
        'ETH/SOL',
        'BONK/SOL',
        'JTO/SOL',
        'RAY/SOL'
    ],
    
    // Tier 3: Lower liquidity pairs (more volatile, higher risk/reward)
    lowerLiquidity: [
        'MNGO/USDC',
        'ATLAS/USDC',
        'POLIS/USDC',
        'STEP/USDC',
        'SAMO/SOL',
        'GMT/USDC',
        'GST/USDC',
        'DUST/USDC',
        'SHDW/USDC',
        'RENDER/USDC'
    ],
    
    // Get all trading pairs as a single array
    getAllPairs: function() {
        return [
            ...this.highLiquidity,
            ...this.mediumLiquidity,
            ...this.lowerLiquidity
        ];
    }
};

// Token-specific trading parameters
const TOKEN_PARAMETERS = {
    // Slippage tolerance settings (in basis points)
    slippageBps: {
        'SOL': 100,      // Standard tokens
        'USDC': 50,      // Stablecoins need less slippage
        'USDT': 50,      // Stablecoins need less slippage
        'BTC': 100,      // Major tokens
        'ETH': 100,      // Major tokens
        'mSOL': 100,     // Liquid staked tokens
        'BONK': 300,     // Memecoins need more slippage
        'SAMO': 300,     // Memecoins need more slippage
        'JTO': 200,      // Newer tokens need more slippage
        'DEFAULT': 150   // Default for other tokens
    },
    
    // Volatility thresholds (minimum % movement to trigger a trade)
    volatilityThresholds: {
        'SOL': 0.04,     // Standard
        'USDC': 0.02,    // Stablecoins have lower thresholds
        'USDT': 0.02,    // Stablecoins have lower thresholds
        'BTC': 0.03,     // BTC is less volatile than SOL
        'ETH': 0.035,    // ETH is less volatile than SOL
        'mSOL': 0.03,    // Liquid staked tokens
        'BONK': 0.08,    // Memecoins need higher thresholds due to noise
        'SAMO': 0.07,    // Memecoins need higher thresholds
        'JTO': 0.05,     // Newer tokens need higher thresholds
        'DEFAULT': 0.05  // Default for other tokens
    },
    
    // Profit requirements as percentage of slippage
    profitRequirements: {
        'SOL': 0.75,     // Standard: 75% of slippage as profit
        'USDC': 0.7,     // Slightly lower for stablecoins
        'USDT': 0.7,     // Slightly lower for stablecoins
        'BTC': 0.75,     // Standard for BTC
        'ETH': 0.75,     // Standard for ETH
        'mSOL': 0.75,    // Standard for mSOL
        'BONK': 0.9,     // Higher profit needed for memecoins
        'SAMO': 0.9,     // Higher profit needed for memecoins
        'JTO': 0.85,     // Higher profit needed for newer tokens
        'DEFAULT': 0.8   // Default for other tokens
    },
    
    // Maximum trade amounts (in token units)
    maxTradeAmount: {
        'SOL': 5.0,      // Maximum 5 SOL per trade
        'USDC': 500,     // Maximum 500 USDC per trade
        'USDT': 500,     // Maximum 500 USDT per trade
        'BTC': 0.01,     // Maximum 0.01 BTC per trade
        'ETH': 0.1,      // Maximum 0.1 ETH per trade
        'mSOL': 5.0,     // Maximum 5 mSOL per trade
        'BONK': 500000,  // Maximum 500K BONK per trade
        'SAMO': 10000,   // Maximum 10K SAMO per trade
        'JTO': 50,       // Maximum 50 JTO per trade
        'DEFAULT': 100   // Default for other tokens
    },
    
    // Get parameter for a specific token (with fallback to default)
    getSlippage: function(token) {
        return this.slippageBps[token] || this.slippageBps.DEFAULT;
    },
    
    getVolatilityThreshold: function(token) {
        return this.volatilityThresholds[token] || this.volatilityThresholds.DEFAULT;
    },
    
    getProfitRequirement: function(token) {
        return this.profitRequirements[token] || this.profitRequirements.DEFAULT;
    },
    
    getMaxTradeAmount: function(token) {
        return this.maxTradeAmount[token] || this.maxTradeAmount.DEFAULT;
    }
};

// Token risk classifications for strategy adjustment
const TOKEN_RISK = {
    // Low risk tokens (conservative trading)
    lowRisk: ['SOL', 'USDC', 'USDT', 'BTC', 'ETH', 'mSOL'],
    
    // Medium risk tokens (balanced trading)
    mediumRisk: ['RAY', 'ORCA', 'JTO', 'JLP', 'SHDW', 'PYTH', 'PORT', 'MNGO', 'STEP', 'SRM'],
    
    // High risk tokens (aggressive trading, smaller positions)
    highRisk: ['BONK', 'SAMO', 'DUST', 'ATLAS', 'POLIS', 'GST', 'GMT', 'MEAN', 'BERN', 'SC'],
    
    // Check risk category of a token
    getRiskCategory: function(token) {
        if (this.lowRisk.includes(token)) return 'low';
        if (this.mediumRisk.includes(token)) return 'medium';
        if (this.highRisk.includes(token)) return 'high';
        return 'high'; // Default to high risk for unknown tokens
    }
};

// Helper functions for token operations
const TokenUtils = {
    // Get token name by address
    getTokenNameByAddress: function(address) {
        for (const [name, addr] of Object.entries(TOKEN_ADDRESSES)) {
            if (addr === address) {
                return name;
            }
        }
        return 'Unknown';
    },
    
    // Get token address by name
    getTokenAddressByName: function(name) {
        return TOKEN_ADDRESSES[name] || null;
    },
    
    // Get token decimals
    getTokenDecimals: function(token) {
        return TOKEN_DECIMALS[token] || TOKEN_DECIMALS.DEFAULT;
    },
    
    // Convert amount to lamports/smallest units
    toSmallestUnits: function(amount, token) {
        const decimals = this.getTokenDecimals(token);
        return Math.floor(amount * Math.pow(10, decimals));
    },
    
    // Convert from lamports/smallest units to token amount
    fromSmallestUnits: function(amount, token) {
        const decimals = this.getTokenDecimals(token);
        return amount / Math.pow(10, decimals);
    }
};

// Export all configurations
module.exports = {
    TOKEN_ADDRESSES,
    TOKEN_DECIMALS,
    TRADING_PAIRS,
    TOKEN_PARAMETERS,
    TOKEN_RISK,
    TokenUtils
};