const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const fetch = require('node-fetch');
const bs58 = require('bs58');
const PriceFetcher = require('./priceFetcher');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

class SolanaTradingBot {
    constructor() {
        // Enhanced Configuration with defaults
        this.config = {
            rpcEndpoint: process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
            minProfitPercentage: parseFloat(process.env.MIN_PROFIT_PERCENTAGE) || 0.3,
            maxSlippage: parseInt(process.env.MAX_SLIPPAGE_BPS) || 100,
            refreshInterval: parseInt(process.env.REFRESH_INTERVAL) || 15000,
            initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 0.1,
            dailyProfitTarget: parseFloat(process.env.DAILY_PROFIT_TARGET) || 2.0,
            minTradeSize: parseFloat(process.env.MIN_TRADE_SIZE) || 0.05,
            maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES) || 3,
            aggressiveMode: process.env.AGGRESSIVE_MODE === 'true'
        };

        // Token Configurations
        this.TOKEN_ADDRESSES = {
            'SOL': 'So11111111111111111111111111111111111111112',
            'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
            'mSOL': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'
        };

        this.TOKEN_DECIMALS = {
            'SOL': 9,
            'USDC': 6,
            'USDT': 6,
            'mSOL': 9
        };

        // Enhanced Trading Configuration
        this.tradingPairs = [
            'SOL/USDC', 
            'SOL/USDT', 
            'USDC/SOL', 
            'USDT/SOL',
            'mSOL/SOL',
            'SOL/mSOL'
        ];

        // Enhanced Bot State
        this.state = {
            wallet: null,
            connection: null,
            balances: {},
            priceHistory: {},
            lastTradeTime: 0,
            dailyProfit: 0,
            totalProfit: 0,
            currentBalance: this.config.initialBalance,
            activeTrades: 0,
            tradeHistory: [],
            status: 'initialized',
            connectionRetries: 0,
            maxRetries: 5
        };

        // Price Fetcher with enhanced functionality
        this.priceFetcher = new PriceFetcher(this.TOKEN_ADDRESSES);

        // Initialize bot
        this.initialize();
    }

    async initialize() {
        try {
            console.log(chalk.blue('Initializing Solana Trading Bot...'));
            
            // Set up Solana connection with retries and multiple providers
            await this.setupConnection();

            // Load wallet with improved error handling
            await this.loadWallet();
            
            // Get initial token balances
            await this.getTokenBalances();

            console.log(chalk.green('Trading bot initialized successfully'));
            
            // Setup log directory
            this.setupLogs();
            
            this.state.status = 'ready';
        } catch (error) {
            console.error(chalk.red('Initialization failed:'), error);
            this.state.status = 'error';
            
            // Try to recover by reinitializing if we haven't exceeded max retries
            if (this.state.connectionRetries < this.state.maxRetries) {
                this.state.connectionRetries++;
                console.log(chalk.yellow(`Attempting to recover (Retry ${this.state.connectionRetries}/${this.state.maxRetries})...`));
                setTimeout(() => this.initialize(), 5000);
            } else {
                throw new Error('Failed to initialize after maximum retries');
            }
        }
    }

    setupLogs() {
        // Create logs directory if it doesn't exist
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir);
        }
        
        // Create trade log file if it doesn't exist
        const tradeLogPath = path.join(logDir, 'trade_history.csv');
        if (!fs.existsSync(tradeLogPath)) {
            fs.writeFileSync(tradeLogPath, 'timestamp,pair,input_amount,input_token,output_amount,output_token,profit,txid\n');
        }
    }

    async setupConnection() {
        // List of backup RPCs in case the primary one fails
        const rpcOptions = [
            this.config.rpcEndpoint,
            'https://api.mainnet-beta.solana.com',
            'https://solana-api.projectserum.com',
            'https://rpc.ankr.com/solana'
        ];
        
        // Try each RPC endpoint until one works
        for (const rpc of rpcOptions) {
            try {
                console.log(chalk.blue(`Attempting to connect to RPC: ${rpc}`));
                
                this.state.connection = new Connection(rpc, 'confirmed');
                
                // Test the connection
                const blockHeight = await this.state.connection.getBlockHeight();
                console.log(chalk.green(`Connected to Solana (Block Height: ${blockHeight})`));
                
                // If we got here, the connection works
                return;
            } catch (error) {
                console.error(chalk.yellow(`Failed to connect to RPC ${rpc}:`, error.message));
                // Continue to the next RPC option
            }
        }
        
        throw new Error('All RPC connection attempts failed');
    }

    async loadWallet() {
        try {
            if (!process.env.PRIVATE_KEY) {
                throw new Error("Private key not found in environment variables");
            }
            
            let secretKey;
            try {
                // Try parsing as JSON array
                const privateKeyArray = JSON.parse(process.env.PRIVATE_KEY);
                secretKey = Uint8Array.from(privateKeyArray);
            } catch {
                // If not JSON array, try base58 decoding
                secretKey = bs58.decode(process.env.PRIVATE_KEY);
            }
            
            this.state.wallet = Keypair.fromSecretKey(secretKey);
            console.log(chalk.green(`Wallet loaded successfully: ${this.state.wallet.publicKey.toString()}`));
            return true;
        } catch (error) {
            console.error(chalk.red('Wallet loading failed:'), error);
            this.state.status = 'wallet_error';
            throw error;
        }
    }

    async getTokenBalances() {
        try {
            const balances = {};
            
            // Get SOL balance with retry mechanism
            let solBalance = 0;
            let solRetries = 0;
            
            while (solRetries < 3) {
                try {
                    solBalance = await this.state.connection.getBalance(this.state.wallet.publicKey);
                    break;
                } catch (error) {
                    console.error(chalk.yellow(`Error fetching SOL balance (attempt ${solRetries + 1}/3):`, error.message));
                    solRetries++;
                    
                    if (solRetries >= 3) {
                        console.error(chalk.red('Failed to fetch SOL balance after 3 attempts'));
                        break;
                    }
                    
                    // Wait before retrying
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            balances['SOL'] = solBalance / 1e9;
            
            // Get SPL token accounts with retry mechanism
            let tokenRetries = 0;
            let tokenAccounts = { value: [] };
            
            while (tokenRetries < 3) {
                try {
                    tokenAccounts = await this.state.connection.getParsedTokenAccountsByOwner(
                        this.state.wallet.publicKey,
                        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
                    );
                    break;
                } catch (error) {
                    console.error(chalk.yellow(`Error fetching token accounts (attempt ${tokenRetries + 1}/3):`, error.message));
                    tokenRetries++;
                    
                    if (tokenRetries >= 3) {
                        console.error(chalk.red('Failed to fetch token accounts after 3 attempts'));
                        break;
                    }
                    
                    // Wait before retrying
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            // Process each token account
            for (const { account } of tokenAccounts.value) {
                try {
                    const tokenMint = account.data.parsed.info.mint;
                    const tokenAmount = account.data.parsed.info.tokenAmount.uiAmount;
                    
                    // Find token name by mint address
                    const tokenName = this.getTokenNameByAddress(tokenMint);
                    
                    if (tokenName !== 'Unknown' && tokenAmount > 0) {
                        balances[tokenName] = tokenAmount;
                    }
                } catch (parseError) {
                    console.error(chalk.yellow(`Error parsing token account:`, parseError.message));
                    // Continue with other token accounts
                }
            }
            
            this.state.balances = balances;
            
            console.log(chalk.green('Token balances:'), 
                Object.entries(balances).map(([name, amount]) => 
                    `${name}: ${amount.toFixed(6)}`
                ).join(', ')
            );
            
            return balances;
        } catch (error) {
            console.error(chalk.red('Error fetching token balances:'), error);
            // In case of error, return the last known balances
            return this.state.balances;
        }
    }

    getTokenNameByAddress(address) {
        for (const [name, addr] of Object.entries(this.TOKEN_ADDRESSES)) {
            if (addr === address) {
                return name;
            }
        }
        return 'Unknown';
    }

    async fetchCurrentPrices() {
        try {
            // Fetch prices for trading pairs
            const pairPrices = await this.priceFetcher.getPrices(this.tradingPairs);
            
            console.log(chalk.green('Prices fetched successfully:'), 
                Object.entries(pairPrices).map(([pair, data]) => 
                    `${pair}: ${data.price.toFixed(4)}`
                ).join(', ')
            );
            
            return pairPrices;
        } catch (error) {
            console.error(chalk.red('Comprehensive price fetching error:'), error);
            return {};
        }
    }

    async findTradingOpportunities(prices) {
        const opportunities = [];
        
        for (const pair of this.tradingPairs) {
            // Track price history
            if (!this.state.priceHistory[pair]) {
                this.state.priceHistory[pair] = [];
            }
            
            const currentPrice = prices[pair];
            if (!currentPrice) continue;
            
            // Add current price to history
            const timestamp = Date.now();
            this.state.priceHistory[pair].push({
                price: currentPrice.price,
                timestamp
            });
            
            // Keep only recent prices
            const historyLimit = 10;
            if (this.state.priceHistory[pair].length > historyLimit) {
                this.state.priceHistory[pair].shift();
            }
            
            // Skip if not enough price history
            if (this.state.priceHistory[pair].length < 2) continue;
            
            // Calculate price change
            const oldPrice = this.state.priceHistory[pair][0].price;
            const priceChangePercent = ((currentPrice.price - oldPrice) / oldPrice) * 100;
            
            // Check if price change meets profit threshold
            if (Math.abs(priceChangePercent) >= this.config.minProfitPercentage) {
                const [inputToken, outputToken] = pair.split('/');
                
                // Determine trade amount based on available balance
                const availableBalance = this.state.balances[inputToken] || 0;
                const suggestedAmount = Math.min(
                    inputToken === 'SOL' ? 0.5 : 
                    (inputToken === 'USDC' || inputToken === 'USDT') ? 20.0 : 0.5,
                    availableBalance * 0.2,  // Only use 20% of available balance for safety
                    Math.max(this.config.minTradeSize, availableBalance * 0.1)
                );
                
                const potentialProfit = (Math.abs(priceChangePercent) / 100) * suggestedAmount * currentPrice.price;
                
                if (suggestedAmount >= this.config.minTradeSize) {
                    opportunities.push({
                        pair,
                        inputToken,
                        outputToken,
                        currentPrice: currentPrice.price,
                        oldPrice: oldPrice,
                        percentChange: priceChangePercent,
                        suggestedAmount,
                        potentialProfit,
                        timestamp
                    });
                }
            }
        }
        
        return opportunities.sort((a, b) => b.potentialProfit - a.potentialProfit);
    }

    async getJupiterQuote(inputToken, outputToken, amount) {
        try {
            const inputDecimals = this.TOKEN_DECIMALS[inputToken] || 9;
            const inputAmountLamports = Math.floor(amount * Math.pow(10, inputDecimals));
            
            // Use the fetch function with retry logic for better reliability
            const fetchWithRetry = async (url, options = {}, maxRetries = 3) => {
                let lastError;
                for (let i = 0; i < maxRetries; i++) {
                    try {
                        const response = await fetch(url, options);
                        if (!response.ok) {
                            const errorText = await response.text();
                            throw new Error(`API error (${response.status}): ${errorText}`);
                        }
                        return await response.json();
                    } catch (error) {
                        console.error(chalk.yellow(`Fetch attempt ${i + 1}/${maxRetries} failed:`, error.message));
                        lastError = error;
                        // Exponential backoff
                        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
                    }
                }
                throw lastError;
            };
            
            const url = `https://quote-api.jup.ag/v6/quote?inputMint=${this.TOKEN_ADDRESSES[inputToken]}&outputMint=${this.TOKEN_ADDRESSES[outputToken]}&amount=${inputAmountLamports}&slippageBps=${this.config.maxSlippage}`;
            return await fetchWithRetry(url);
        } catch (error) {
            console.error(chalk.red('Error fetching quote:'), error.message);
            return null;
        }
    }

    async executeJupiterSwap(quoteResponse, amount, inputToken) {
        try {
            const inputMint = quoteResponse.inputMint;
            const inputTokenName = this.getTokenNameByAddress(inputMint) || inputToken;
            const decimals = this.TOKEN_DECIMALS[inputTokenName] || 9;
            
            const amountInSmallestUnit = Math.floor(amount * Math.pow(10, decimals));
            
            const response = await fetch('https://quote-api.jup.ag/v6/swap', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userPublicKey: this.state.wallet.publicKey.toString(),
                    wrapUnwrapSOL: true,
                    useVersionedTransaction: true,
                    computeUnitPriceMicroLamports: 10000,
                    dynamicComputeUnitLimit: true,
                    slippageBps: this.config.maxSlippage,
                    quoteResponse: {
                        inputMint: quoteResponse.inputMint,
                        outputMint: quoteResponse.outputMint,
                        amount: amountInSmallestUnit.toString(),
                        slippageBps: this.config.maxSlippage,
                        otherAmountThreshold: quoteResponse.otherAmountThreshold,
                        swapMode: quoteResponse.swapMode || "ExactIn",
                        routePlan: quoteResponse.routePlan || []
                    }
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(chalk.red(`Jupiter API error (${response.status}): ${errorText}`));
                return false;
            }
            
            const swapResponse = await response.json();
            
            if (!swapResponse || !swapResponse.swapTransaction) {
                console.error(chalk.red(`Failed to get swap transaction: ${JSON.stringify(swapResponse)}`));
                return false;
            }
            
            const transactionBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuffer);
            
            transaction.sign([this.state.wallet]);
            
            console.log(chalk.yellow('Sending transaction to Solana...'));
            const txid = await this.state.connection.sendTransaction(transaction, {
                skipPreflight: true,
                maxRetries: 3,
            });
            
            console.log(chalk.yellow(`Transaction sent: ${txid}`));
            console.log(chalk.yellow('Waiting for confirmation...'));
            
            try {
                const confirmation = await this.state.connection.confirmTransaction(
                    {signature: txid, blockhash: transaction.message.recentBlockhash, lastValidBlockHeight: 150000000},
                    'confirmed'
                );
                
                if (confirmation.value.err) {
                    console.error(chalk.red(`Transaction failed: ${confirmation.value.err}`));
                    return false;
                }
            } catch (confirmError) {
                console.error(chalk.yellow(`Confirmation timeout, checking transaction status...`));
                
                // Check transaction status separately
                const status = await this.checkTransactionStatus(txid);
                if (!status.success) {
                    console.error(chalk.red(`Transaction failed: ${status.error || 'Unknown error'}`));
                    return false;
                }
            }
            
            console.log(chalk.green(`Swap executed successfully! Transaction ID: ${txid}`));
            
            const outputMint = quoteResponse.outputMint;
            const outputTokenName = this.getTokenNameByAddress(outputMint) || 'Unknown';
            const outputDecimals = this.TOKEN_DECIMALS[outputTokenName] || 9;
            
            const outputAmount = parseInt(quoteResponse.outAmount) / Math.pow(10, outputDecimals);
            
            console.log(chalk.green(`Swap details: ${amount} ${inputToken} -> ${outputAmount.toFixed(6)} ${outputTokenName}`));
            
            return {
                success: true,
                txid,
                inputAmount: amount,
                outputAmount,
                inputToken,
                outputToken: outputTokenName
            };
        } catch (error) {
            console.error(chalk.red('Error executing Jupiter swap:'), error.message);
            return false;
        }
    }

    async checkTransactionStatus(signature, maxAttempts = 5) {
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            try {
                const status = await this.state.connection.getSignatureStatus(signature);
                
                if (status && status.value) {
                    if (status.value.err) {
                        return { success: false, error: JSON.stringify(status.value.err) };
                    } else if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
                        return { success: true };
                    }
                }
                
                // Transaction still pending, wait and retry
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempts++;
            } catch (error) {
                console.error(chalk.yellow(`Error checking transaction status (attempt ${attempts + 1}/${maxAttempts}):`, error.message));
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // After all attempts, assume transaction may have succeeded and log to investigate manually
        console.log(chalk.yellow(`Could not confirm transaction status after ${maxAttempts} attempts. Transaction ID: ${signature}`));
        return { success: true, warning: 'Unconfirmed' };
    }

    async executeTradeOpportunity(opportunity) {
        try {
            console.log(chalk.yellow('Executing trade opportunity:'));
            console.log(`Pair: ${opportunity.pair}`);
            console.log(`Amount: ${opportunity.suggestedAmount.toFixed(6)} ${opportunity.inputToken}`);
            console.log(`Price change: ${opportunity.percentChange.toFixed(2)}%`);
            
            // Get fresh quote for this opportunity
            const quoteData = await this.getJupiterQuote(
                opportunity.inputToken, 
                opportunity.outputToken, 
                opportunity.suggestedAmount
            );
            
            if (!quoteData) {
                console.error(chalk.red('Failed to get quote data'));
                return false;
            }
            
            // Execute the swap with the quote
            const result = await this.executeJupiterSwap(
                quoteData, 
                opportunity.suggestedAmount, 
                opportunity.inputToken
            );
            
            if (result && result.success) {
                // Calculate realized profit 
                const realizedProfit = result.outputAmount - (opportunity.suggestedAmount * opportunity.currentPrice);
                
                // Record profit (approximate SOL equivalent)
                const solEquivalentProfit = opportunity.outputToken === 'SOL' ? 
                    realizedProfit : 
                    (opportunity.outputToken === 'USDC' || opportunity.outputToken === 'USDT') ? 
                        realizedProfit / 20 : // Rough SOL/USD approximation
                        realizedProfit * 0.5; // Generic approximation
                
                this.recordProfit(solEquivalentProfit, result, opportunity);
                
                console.log(chalk.green('Trade executed successfully'));
                console.log(`Transaction ID: ${result.txid}`);
                console.log(`Realized profit: ${realizedProfit.toFixed(6)} ${opportunity.outputToken} (≈ ${solEquivalentProfit.toFixed(6)} SOL)`);
                
                // Update balances after trade
                await this.getTokenBalances();
                
                return true;
            } else {
                console.log(chalk.red('Trade execution failed'));
                return false;
            }
        } catch (error) {
            console.error(chalk.red('Error executing trade:'), error.message);
            return false;
        }
    }

    recordProfit(amount, tradeResult, opportunity) {
        this.state.dailyProfit += amount;
        this.state.totalProfit += amount;
        
        const timestamp = new Date().toISOString();
        const tradeRecord = {
            timestamp,
            pair: opportunity.pair,
            inputAmount: tradeResult.inputAmount,
            inputToken: tradeResult.inputToken,
            outputAmount: tradeResult.outputAmount,
            outputToken: tradeResult.outputToken,
            profit: amount,
            txid: tradeResult.txid
        };
        
        // Add to trade history
        this.state.tradeHistory.push(tradeRecord);
        
        // Trim trade history to last 50 trades
        if (this.state.tradeHistory.length > 50) {
            this.state.tradeHistory.shift();
        }
        
        // Log to CSV file
        const logEntry = `${timestamp},${opportunity.pair},${tradeResult.inputAmount},${tradeResult.inputToken},${tradeResult.outputAmount},${tradeResult.outputToken},${amount},${tradeResult.txid}\n`;
        fs.appendFileSync(path.join(__dirname, 'logs', 'trade_history.csv'), logEntry);
        
        // Check daily profit target
        this.checkProfitTarget();
    }

    checkProfitTarget() {
        if (this.state.dailyProfit >= this.config.dailyProfitTarget) {
            console.log(chalk.green(`Daily profit target reached: ${this.state.dailyProfit.toFixed(4)} SOL`));
            
            // Optionally pause trading or take specific action
            if (!this.config.aggressiveMode) {
                this.stop();
            }
        }
    }

    async start() {
        console.log(chalk.blue('Starting Solana Trading Bot'));
        
        // Initial token balance check
        await this.getTokenBalances();
        
        // Update bot status
        this.state.status = 'running';
        
        // Reset daily profit at the start of new day
        if (new Date().getHours() === 0 && new Date().getMinutes() < 10) {
            this.state.dailyProfit = 0;
            console.log(chalk.blue('Daily profit counter reset for new day'));
        }
        
        // Tracking variables
        let lastTradeTime = 0;
        const minTradeInterval = 30000; // 30 seconds minimum between trades
        
        // Main trading loop
        const tradingInterval = setInterval(async () => {
            try {
                // Get current time
                const currentTime = Date.now();
                
                // Skip if less than minimum interval since last trade
                if (currentTime - lastTradeTime < minTradeInterval) {
                    return;
                }
                
                // Fetch current prices
                const currentPrices = await this.fetchCurrentPrices();
                
                // Find trading opportunities
                const opportunities = await this.findTradingOpportunities(currentPrices);
                
                // Check if we should execute a trade
                if (opportunities.length > 0 && 
                    this.state.activeTrades < this.config.maxConcurrentTrades) {
                    
                    // Sort opportunities by potential profit
                    opportunities.sort((a, b) => b.potentialProfit - a.potentialProfit);
                    
                    const bestOpportunity = opportunities[0];
                    console.log(chalk.blue(`Found trading opportunity: ${bestOpportunity.pair} (${bestOpportunity.percentChange.toFixed(2)}% change)`));
                    
                    // Skip small opportunities
                    if (bestOpportunity.potentialProfit < 0.001) {
                        console.log(chalk.yellow(`Skipping low profit opportunity: ${bestOpportunity.potentialProfit.toFixed(6)} ${bestOpportunity.outputToken}`));
                        return;
                    }
                    
                    // Increment active trades
                    this.state.activeTrades++;
                    
                    // Execute trade
                    const success = await this.executeTradeOpportunity(bestOpportunity);
                    
                    // Update last trade time if successful
                    if (success) {
                        lastTradeTime = currentTime;
                    }
                    
                    // Decrement active trades
                    this.state.activeTrades--;
                } else {
                    // Periodically update balances even without trades
                    if (currentTime - lastTradeTime > 300000) { // 5 minutes
                        await this.getTokenBalances();
                        lastTradeTime = currentTime - 290000; // Reset timer but don't fully reset
                    }
                }
            } catch (error) {
                console.error(chalk.red('Trading loop error:'), error);
                
                // Recover from errors
                this.state.activeTrades = Math.max(0, this.state.activeTrades - 1);
                
                // Check if connection needs to be reestablished
                if (error.message.includes('failed to fetch') || error.message.includes('connection') || error.message.includes('network')) {
                    console.log(chalk.yellow('Network error detected. Attempting to reestablish connection...'));
                    await this.setupConnection();
                }
            }
        }, this.config.refreshInterval);
        
        // Store interval for potential cleanup
        this.state.tradingInterval = tradingInterval;
    }

    stop() {
        if (this.state.tradingInterval) {
            clearInterval(this.state.tradingInterval);
        }
        this.state.status = 'stopped';
        console.log(chalk.yellow('Trading bot stopped'));
    }

    async getPerformanceStats() {
        await this.getTokenBalances();
        
        return {
            status: this.state.status,
            wallet: this.state.wallet ? this.state.wallet.publicKey.toString() : null,
            balances: this.state.balances,
            currentBalance: this.state.balances['SOL'] || 0,
            dailyProfit: this.state.dailyProfit,
            totalProfit: this.state.totalProfit,
            activeTrades: this.state.activeTrades,
            recentTrades: this.state.tradeHistory.slice(-5)
        };
    }
}

// Export the trading bot class
module.exports = SolanaTradingBot;

// If run directly, start the bot
if (require.main === module) {
    const bot = new SolanaTradingBot();
    bot.start().catch(console.error);
    
    // Add signal handlers for graceful shutdown
    process.on('SIGINT', () => {
        console.log(chalk.yellow('\nShutting down gracefully...'));
        bot.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log(chalk.yellow('\nShutting down gracefully...'));
        bot.stop();
        process.exit(0);
    });
}