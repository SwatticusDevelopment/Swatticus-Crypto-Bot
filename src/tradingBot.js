/**
 * Solana Real-Time Trading Bot
 * Direct Wallet Trading Strategy
 */

const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const fetch = require('node-fetch');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

// Advanced Configuration
const TRADING_CONFIG = {
    RPC_ENDPOINT: process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
    JUPITER_QUOTE_API: 'https://quote-api.jup.ag/v6/quote',
    JUPITER_SWAP_API: 'https://quote-api.jup.ag/v6/swap',
    
    // Trading Parameters
    MIN_PROFIT_PERCENTAGE: parseFloat(process.env.MIN_PROFIT_PERCENTAGE) || 0.5,
    MAX_SLIPPAGE_BPS: parseInt(process.env.MAX_SLIPPAGE_BPS) || 500, // 5% slippage tolerance
    MAX_TRADE_AMOUNT: parseFloat(process.env.MAX_TRADE_AMOUNT) || 0.5, // Max SOL to trade
    MIN_TRADE_AMOUNT: parseFloat(process.env.MIN_TRADE_AMOUNT) || 0.05, // Minimum trade size
    TRADE_COOLDOWN: parseInt(process.env.TRADE_COOLDOWN) || 300000, // 5 minutes between trades
};

// Comprehensive Token Configurations
const TOKEN_CONFIGS = {
    TOKENS: {
        'SOL': {
            address: 'So11111111111111111111111111111111111111112',
            decimals: 9
        },
        'USDC': {
            address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            decimals: 6
        },
        'USDT': {
            address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
            decimals: 6
        },
        'mSOL': {
            address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
            decimals: 9
        }
    },
    
    // Predefined Trading Pairs
    TRADING_PAIRS: [
        'SOL/USDC',
        'SOL/USDT',
        'USDC/SOL',
        'USDT/SOL',
        'mSOL/SOL',
        'SOL/mSOL'
    ]
};

class SolanaRealTradeBot {
    constructor(privateKey) {
        // Initialize core trading components
        this.connection = null;
        this.wallet = null;
        this.priceHistory = {};
        this.lastTradeTimestamp = 0;
        this.tradingStats = {
            totalTrades: 0,
            totalProfit: 0,
            consecutiveProfitableTrades: 0,
            consecutiveLosses: 0
        };

        // Initialize wallet and connection
        this.initializeWallet(privateKey);
    }

    // Secure Wallet Initialization
    initializeWallet(privateKey) {
        try {
            // Support multiple private key formats
            let secretKey;
            if (Array.isArray(privateKey)) {
                // JSON array format
                secretKey = Uint8Array.from(privateKey);
            } else if (typeof privateKey === 'string') {
                // Base58 or other encoded format
                const bs58 = require('bs58');
                secretKey = bs58.decode(privateKey);
            } else {
                throw new Error('Invalid private key format');
            }

            // Create wallet and connection
            this.wallet = Keypair.fromSecretKey(secretKey);
            this.connection = new Connection(
                TRADING_CONFIG.RPC_ENDPOINT, 
                'confirmed'
            );

            console.log(chalk.green(`Wallet initialized: ${this.wallet.publicKey.toString()}`));
        } catch (error) {
            console.error(chalk.red('Wallet initialization failed:'), error);
            throw error;
        }
    }

    // Comprehensive Balance Checker
    async getWalletBalances() {
        try {
            const balances = {};

            // Check SOL balance
            const solBalance = await this.connection.getBalance(this.wallet.publicKey);
            balances['SOL'] = solBalance / 1e9;

            // Check SPL Token Balances
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                this.wallet.publicKey,
                { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
            );

            // Process token accounts
            for (const { account } of tokenAccounts.value) {
                const mint = account.data.parsed.info.mint;
                const amount = account.data.parsed.info.tokenAmount.uiAmount;

                // Match mint to known tokens
                for (const [tokenName, tokenConfig] of Object.entries(TOKEN_CONFIGS.TOKENS)) {
                    if (tokenConfig.address === mint) {
                        balances[tokenName] = amount;
                        break;
                    }
                }
            }

            return balances;
        } catch (error) {
            console.error(chalk.red('Balance fetch error:'), error);
            return {};
        }
    }

    // Advanced Price Fetcher with Multiple Sources
    async fetchCurrentPrices() {
        try {
            const response = await fetch('https://quote-api.jup.ag/v6/price', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ids: Object.values(TOKEN_CONFIGS.TOKENS).map(t => t.address)
                })
            });

            const priceData = await response.json();
            const prices = {};

            // Calculate pair prices
            for (const pair of TOKEN_CONFIGS.TRADING_PAIRS) {
                const [inputToken, outputToken] = pair.split('/');
                const inputAddress = TOKEN_CONFIGS.TOKENS[inputToken].address;
                const outputAddress = TOKEN_CONFIGS.TOKENS[outputToken].address;

                const inputPrice = priceData[inputAddress]?.price || 1;
                const outputPrice = priceData[outputAddress]?.price || 1;

                prices[pair] = {
                    price: outputPrice / inputPrice,
                    timestamp: Date.now()
                };

                // Update price history
                if (!this.priceHistory[pair]) {
                    this.priceHistory[pair] = [];
                }
                this.priceHistory[pair].push({
                    price: outputPrice / inputPrice,
                    timestamp: Date.now()
                });

                // Limit price history length
                if (this.priceHistory[pair].length > 10) {
                    this.priceHistory[pair].shift();
                }
            }

            return prices;
        } catch (error) {
            console.error(chalk.red('Price fetching error:'), error);
            return {};
        }
    }

    // Advanced Opportunity Detection
    detectTradingOpportunities(prices) {
        const opportunities = [];

        for (const pair of TOKEN_CONFIGS.TRADING_PAIRS) {
            const history = this.priceHistory[pair];
            if (history && history.length >= 2) {
                const oldestPrice = history[0].price;
                const latestPrice = history[history.length - 1].price;
                
                const percentChange = ((latestPrice - oldestPrice) / oldestPrice) * 100;
                
                // Check if price change meets profit threshold
                if (Math.abs(percentChange) >= TRADING_CONFIG.MIN_PROFIT_PERCENTAGE) {
                    const [inputToken, outputToken] = pair.split('/');
                    
                    opportunities.push({
                        pair,
                        inputToken,
                        outputToken,
                        percentChange,
                        oldPrice: oldestPrice,
                        newPrice: latestPrice
                    });
                }
            }
        }

        return opportunities.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));
    }

    // Jupiter Quote Retrieval
    async getSwapQuote(inputToken, outputToken, amount) {
        try {
            const inputTokenConfig = TOKEN_CONFIGS.TOKENS[inputToken];
            const outputTokenConfig = TOKEN_CONFIGS.TOKENS[outputToken];

            // Convert amount to smallest token unit
            const amountInSmallestUnit = Math.floor(
                amount * Math.pow(10, inputTokenConfig.decimals)
            );

            const response = await fetch(TRADING_CONFIG.JUPITER_QUOTE_API, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inputMint: inputTokenConfig.address,
                    outputMint: outputTokenConfig.address,
                    amount: amountInSmallestUnit.toString(),
                    slippageBps: TRADING_CONFIG.MAX_SLIPPAGE_BPS
                })
            });

            return await response.json();
        } catch (error) {
            console.error(chalk.red('Quote retrieval error:'), error);
            return null;
        }
    }

    // Real Token Swap Execution
    async executeSwap(opportunity) {
        try {
            // Validate trade cooldown
            const currentTime = Date.now();
            if (currentTime - this.lastTradeTimestamp < TRADING_CONFIG.TRADE_COOLDOWN) {
                console.log(chalk.yellow('Trade cooldown in effect. Skipping trade.'));
                return null;
            }

            // Determine trade amount
            const balances = await this.getWalletBalances();
            const availableBalance = balances[opportunity.inputToken] || 0;
            
            const tradeAmount = Math.min(
                opportunity.inputToken === 'SOL' ? TRADING_CONFIG.MAX_TRADE_AMOUNT : 20,
                availableBalance * 0.5,
                Math.max(TRADING_CONFIG.MIN_TRADE_AMOUNT, availableBalance * 0.1)
            );

            // Get swap quote
            const quoteResponse = await this.getSwapQuote(
                opportunity.inputToken, 
                opportunity.outputToken, 
                tradeAmount
            );

            if (!quoteResponse) {
                console.log(chalk.red('Failed to get swap quote'));
                return null;
            }

            // Prepare swap transaction
            const swapResponse = await fetch(TRADING_CONFIG.JUPITER_SWAP_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userPublicKey: this.wallet.publicKey.toString(),
                    wrapUnwrapSOL: true,
                    useVersionedTransaction: true,
                    quoteResponse
                })
            });

            const swapData = await swapResponse.json();

            // Deserialize and send transaction
            const transactionBuffer = Buffer.from(swapData.swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuffer);
            
            transaction.sign([this.wallet]);

            const txid = await this.connection.sendTransaction(transaction, {
                skipPreflight: false,
                maxRetries: 3
            });

            // Confirm transaction
            const confirmation = await this.connection.confirmTransaction(
                { signature: txid, blockhash: transaction.message.recentBlockhash, lastValidBlockHeight: 150000000 },
                'confirmed'
            );

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            // Update trading stats
            this.lastTradeTimestamp = currentTime;
            this.tradingStats.totalTrades++;

            // Log trade details
            this.logTrade({
                pair: opportunity.pair,
                inputToken: opportunity.inputToken,
                outputToken: opportunity.outputToken,
                inputAmount: tradeAmount,
                txid
            });

            console.log(chalk.green(`Successful swap: ${tradeAmount} ${opportunity.inputToken} -> ${opportunity.outputToken}`));
            return txid;
        } catch (error) {
            console.error(chalk.red('Swap execution error:'), error);
            return null;
        }
    }

    // Trade Logging
    logTrade(tradeDetails) {
        const logPath = path.join(__dirname, 'trade_logs.csv');
        const logEntry = `${new Date().toISOString()},${tradeDetails.pair},${tradeDetails.inputToken},${tradeDetails.inputAmount},${tradeDetails.outputToken},${tradeDetails.txid}\n`;
        
        try {
            fs.appendFileSync(logPath, logEntry);
        } catch (error) {
            console.error(chalk.red('Error logging trade:'), error);
        }
    }

    // Continuous Trading Loop
    async startTrading() {
        console.log(chalk.blue('Starting continuous trading bot...'));
        
        const tradingInterval = setInterval(async () => {
            try {
                // Fetch current prices
                const prices = await this.fetchCurrentPrices();
                
                // Find trading opportunities
                const opportunities = this.detectTradingOpportunities(prices);
                
                // Execute first viable opportunity
                if (opportunities.length > 0) {
                    await this.executeSwap(opportunities[0]);
                }
            } catch (error) {
                console.error(chalk.red('Trading loop error:'), error);
            }
        }, 300000); // Run every 5 minutes

        return tradingInterval;
    }

    // Stop Trading
    stopTrading(intervalId) {
        clearInterval(intervalId);
        console.log(chalk.yellow('Trading bot stopped.'));
    }
}

// Export the trading bot class
module.exports = SolanaRealTradeBot;