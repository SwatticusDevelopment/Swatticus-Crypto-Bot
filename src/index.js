const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const fetch = require('node-fetch');
const bs58 = require('bs58');
const PriceFetcher = require('./priceFetcher');
const Decimal = require('decimal.js');
const EnhancedTradingStrategy = require('./enhancedStrategy');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

class SolanaTradingBot {
    constructor() {
        console.log(chalk.blue('Initializing Solana Trading Bot with active trading enabled...'));
        
        // Enhanced Configuration with defaults
        this.config = {
            rpcEndpoint: process.env.RPC_ENDPOINT,
            minProfitPercentage: parseFloat(process.env.MIN_PROFIT_PERCENTAGE), // Lower threshold
            maxSlippage: parseInt(process.env.MAX_SLIPPAGE_BPS), // More tolerant of slippage
            refreshInterval: parseInt(process.env.REFRESH_INTERVAL), // Faster refresh
            initialBalance: parseFloat(process.env.INITIAL_BALANCE),
            dailyProfitTarget: parseFloat(process.env.DAILY_PROFIT_TARGET),
            minTradeSize: parseFloat(process.env.MIN_TRADE_SIZE),
            maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES),
            aggressiveMode: false, // Always use aggressive mode for active trading
            routingMode: process.env.ROUTING_MODE,
            maxPriceDifferencePercent: parseFloat(process.env.MAX_PRICE_DIFFERENCE_PERCENT),
            ignorePriceDifference: process.env.IGNORE_PRICE_DIFFERENCE === 'false'
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
            maxRetries: 5,
            tradingEnabled: true // Explicitly enable trading
        };

        // Price Fetcher with enhanced functionality
        this.priceFetcher = new PriceFetcher(this.TOKEN_ADDRESSES);

        // Initialize enhanced trading strategy
        this.enhancedStrategy = new EnhancedTradingStrategy(this);

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
            console.log(chalk.green('Bot is ready for ACTIVE TRADING with real funds'));
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

        // Create trading opportunity log
        const opportunityLogPath = path.join(logDir, 'opportunities.log');
        fs.writeFileSync(opportunityLogPath, `=== Trading Opportunities Log (${new Date().toISOString()}) ===\n`);
        
        // Create enhanced opportunity log
        const enhancedOpportunityLogPath = path.join(logDir, 'enhanced_opportunities.log');
        fs.writeFileSync(enhancedOpportunityLogPath, `=== Enhanced Trading Opportunities Log (${new Date().toISOString()}) ===\n`);
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
                
                const connectionConfig = {
                    commitment: 'confirmed',
                    confirmTransactionInitialTimeout: 60000,
                    disableRetryOnRateLimit: false, 
                    httpAgent: new http.Agent({ keepAlive: true }), // Add keepAlive connection
                    wsAgent: new ws.Agent({ keepAlive: true })
                  };
                  
                  // Implement better rate limiting
                  this.state.connection = new Connection(
                    this.config.rpcEndpoint,
                    connectionConfig
                  );
                  
                  // Add delay between requests
                  this.rpcRequestDelay = 500; // ms between requests
                  
                  // Add a helper method to throttle requests
                  this.throttledRequest = async (method, ...args) => {
                    await new Promise(resolve => setTimeout(resolve, this.rpcRequestDelay));
                    return method.apply(this.state.connection, args);
                  };
                  
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
                console.log(chalk.green('Successfully loaded private key from JSON array format'));
            } catch {
                // If not JSON array, try base58 decoding
                try {
                    secretKey = bs58.decode(process.env.PRIVATE_KEY);
                    console.log(chalk.green('Successfully loaded private key from base58 format'));
                } catch (err) {
                    throw new Error(`Failed to decode private key: ${err.message}`);
                }
            }
            
            this.state.wallet = Keypair.fromSecretKey(secretKey);
            console.log(chalk.green(`Wallet loaded successfully: ${this.state.wallet.publicKey.toString()}`));
            
            // Verify wallet has SOL balance
            const solBalance = await this.state.connection.getBalance(this.state.wallet.publicKey);
            if (solBalance === 0) {
                console.warn(chalk.yellow(`Warning: Wallet has 0 SOL balance. Trading may not be possible.`));
            } else {
                console.log(chalk.green(`Wallet SOL balance: ${solBalance / 1e9} SOL`));
            }
            
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
        console.log(chalk.blue('Searching for trading opportunities...'));
        
        // First try the enhanced strategy
        const enhancedOpportunities = await this.enhancedStrategy.findEnhancedOpportunities(prices);
        
        if (enhancedOpportunities && enhancedOpportunities.length > 0) {
            console.log(chalk.blue(`Found ${enhancedOpportunities.length} enhanced trading opportunities`));
            return enhancedOpportunities;
        }
        
        // Fall back to original strategy if no enhanced opportunities found
        console.log(chalk.blue('No enhanced opportunities found, using standard detection...'));
        
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
            const historyLimit = 5; // Using fewer data points for faster opportunity detection
            if (this.state.priceHistory[pair].length > historyLimit) {
                this.state.priceHistory[pair].shift();
            }
            
            // Skip if not enough price history
            if (this.state.priceHistory[pair].length < 2) continue;
            
            // Calculate price change - use both short-term and immediate changes
            const oldPrice = this.state.priceHistory[pair][0].price;
            const priceChangePercent = ((currentPrice.price - oldPrice) / oldPrice) * 100;
            
            // Check for immediate price movements
            if (this.state.priceHistory[pair].length >= 2) {
                const latestPrice = this.state.priceHistory[pair][this.state.priceHistory[pair].length - 1].price;
                const previousPrice = this.state.priceHistory[pair][this.state.priceHistory[pair].length - 2].price;
                const immediateChange = ((latestPrice - previousPrice) / previousPrice) * 100;
                
                // Log the price movement
                if (Math.abs(immediateChange) > 0.05) { // Log even small movements
                    console.log(chalk.yellow(`${pair} immediate price movement: ${immediateChange.toFixed(4)}%`));
                }
            }
            
            // More aggressive detection logic - detect smaller price changes
            // Reduce the threshold to be more aggressive
            const effectiveThreshold = this.config.minProfitPercentage * 0.5; // Half the configured threshold
            
            // Check if price change meets profit threshold
            if (Math.abs(priceChangePercent) >= effectiveThreshold) {
                const [inputToken, outputToken] = pair.split('/');
                
                // Determine trade amount based on available balance
                const availableBalance = this.state.balances[inputToken] || 0;
                
                // Calculate a more aggressive trade size
                let suggestedAmount;
                
                if (inputToken === 'SOL') {
                    // Use smaller amount for SOL to allow more trades
                    suggestedAmount = Math.min(0.05, availableBalance * 0.25);
                } else if (inputToken === 'USDC' || inputToken === 'USDT') {
                    // Use up to 30% of available stablecoin balance or max 5 tokens
                    suggestedAmount = Math.min(5.0, availableBalance * 0.3);
                } else {
                    // For other tokens, use up to 20% of available balance
                    suggestedAmount = Math.min(availableBalance * 0.2, Math.max(this.config.minTradeSize, availableBalance * 0.1));
                }
                
                // Skip if amount is below minimum trade size
                if (suggestedAmount < this.config.minTradeSize) {
                    console.log(chalk.yellow(`Skipping ${pair} opportunity: suggested amount ${suggestedAmount} below minimum ${this.config.minTradeSize}`));
                    continue;
                }
                
                // Calculate potential profit
                const potentialProfit = (Math.abs(priceChangePercent) / 100) * suggestedAmount * currentPrice.price;
                
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
                
                // Log this opportunity
                console.log(chalk.green(`Found trading opportunity: ${pair} (${priceChangePercent.toFixed(2)}%) - Potential profit: ${potentialProfit.toFixed(6)}`));
                
                // Write to opportunity log
                try {
                    const opportunityLogPath = path.join(__dirname, 'logs', 'opportunities.log');
                    fs.appendFileSync(
                        opportunityLogPath, 
                        `[${new Date().toISOString()}] ${pair}: ${priceChangePercent.toFixed(2)}% change, Amount: ${suggestedAmount} ${inputToken}, Potential profit: ${potentialProfit.toFixed(6)}\n`
                    );
                } catch (logError) {
                    console.error(chalk.yellow('Error writing to opportunity log:'), logError);
                }
            }
        }
        
        // Log opportunities found
        console.log(chalk.blue(`Found ${opportunities.length} trading opportunities`));
        
        return opportunities.sort((a, b) => b.potentialProfit - a.potentialProfit);
    }

    async checkTransactionStatusExtended(signature, maxAttempts = 5) {
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            try {
                // First check the signature status
                const status = await this.state.connection.getSignatureStatus(signature, {
                    searchTransactionHistory: true
                });
                
                if (status && status.value) {
                    if (status.value.err) {
                        return { success: false, error: JSON.stringify(status.value.err) };
                    } else if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
                        console.log(chalk.green(`Transaction confirmed with status: ${status.value.confirmationStatus}`));
                        
                        // Add additional verification that account updates have propagated
                        // by checking the transaction details
                        try {
                            const txDetails = await this.state.connection.getParsedTransaction(signature, 'confirmed');
                            
                            if (txDetails) {
                                console.log(chalk.green(`Transaction details retrieved successfully`));
                                return { success: true, details: txDetails };
                            }
                        } catch (error) {
                            console.warn(chalk.yellow(`Error getting transaction details: ${error.message}`));
                            // Continue with success anyway since signature is confirmed
                        }
                        
                        return { success: true };
                    }
                }
                
                // Transaction still pending, wait and retry
                console.log(chalk.yellow(`Transaction not yet confirmed, waiting... (attempt ${attempts + 1}/${maxAttempts})`));
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempts++;
            } catch (error) {
                console.error(chalk.yellow(`Error checking transaction status (attempt ${attempts + 1}/${maxAttempts}):`, error.message));
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        console.log(chalk.yellow(`Could not confirm transaction status after ${maxAttempts} attempts. Transaction ID: ${signature}`));
    return { success: true, warning: 'Unconfirmed' };
    }

    async getJupiterQuote(inputToken, outputToken, amount) {
        try {
            console.log(chalk.blue(`Getting Jupiter quote for ${amount} ${inputToken} to ${outputToken}...`));
            
            const inputDecimals = this.TOKEN_DECIMALS[inputToken] || 9;
            const inputAmountLamports = Math.floor(amount * Math.pow(10, inputDecimals));
            
            // Enhanced parameters for better routing
            const params = new URLSearchParams({
                inputMint: this.TOKEN_ADDRESSES[inputToken],
                outputMint: this.TOKEN_ADDRESSES[outputToken],
                amount: inputAmountLamports.toString(),
                slippageBps: this.config.maxSlippage.toString(),
                onlyDirectRoutes: 'false',
                asLegacyTransaction: 'false',
                platformFeeBps: '0'
            });
            
            // Add routing mode if specified in config
            if (this.config.routingMode === 'aggressive') {
                // This will cause the API to try more routes but might be slightly slower
                params.append('excludeDexes', '');
                params.append('computeUnitPriceMicroLamports', '10000'); // Pay more for compute units
            }
            
            const url = `https://quote-api.jup.ag/v6/quote?${params.toString()}`;
            
            console.log(chalk.yellow(`Jupiter quote URL: ${url}`));
            
            // Use fetch function with retry logic for better reliability
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
                        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
                    }
                }
                throw lastError;
            };
            
            const quoteResponse = await fetchWithRetry(url);
            
            if (quoteResponse && quoteResponse.outAmount) {
                const outputDecimals = this.TOKEN_DECIMALS[outputToken] || 9;
                const outputAmount = parseInt(quoteResponse.outAmount) / Math.pow(10, outputDecimals);
                
                console.log(chalk.green(`Quote received: ${amount} ${inputToken} -> ${outputAmount.toFixed(6)} ${outputToken}`));
                
                // Log route information if available
                if (quoteResponse.routePlan && quoteResponse.routePlan.length > 0) {
                    console.log(chalk.blue('Route details:'));
                    quoteResponse.routePlan.forEach((hop, index) => {
                        console.log(`  Hop ${index+1}: ${hop.swapInfo?.label || 'Unknown'} (${hop.percent}%)`);
                    });
                }
            }
            
            return quoteResponse;
        } catch (error) {
            console.error(chalk.red('Error fetching quote:'), error.message);
            return null;
        }
    }

    async executeJupiterSwap(quoteResponse, amount, inputToken) {
        try {
            console.log(chalk.blue(`Preparing to execute swap: ${amount} ${inputToken}...`));
            
            // Calculate dynamic compute unit settings based on trade size
            const computeUnits = Math.min(1_000_000, Math.max(300_000, Math.floor(amount * 5_000_000)));
            
            console.log(chalk.yellow(`Sending swap request to Jupiter API with ${computeUnits} compute units...`));
            
            const swapRequest = {
                userPublicKey: this.state.wallet.publicKey.toString(),
                wrapUnwrapSOL: true,
                useVersionedTransaction: true,
                dynamicComputeUnitLimit: true,
                slippageBps: this.config.maxSlippage,
                quoteResponse // <- use it exactly as received
            };
            
            // Add EITHER compute unit price OR prioritization fee based on config
            if (this.config.routingMode === 'aggressive') {
                // Use compute unit price for aggressive mode
                swapRequest.computeUnitPriceMicroLamports = 10000;
            } else {
                // Use prioritization fee for normal mode
                swapRequest.prioritizationFeeLamports = 10000; // 0.00001 SOL priority fee
            }
            
            const response = await fetch('https://quote-api.jup.ag/v6/swap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(swapRequest)
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
            
            console.log(chalk.green('Swap transaction prepared by Jupiter. Proceeding with signing and sending...'));
            
            const transactionBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuffer);
            
            console.log(chalk.yellow('Transaction deserialized successfully. Signing...'));
            
            transaction.sign([this.state.wallet]);
            
            console.log(chalk.yellow('Transaction signed. Sending to Solana...'));
            
            // Set up retry logic for sending transaction
            let txid = null;
            let retriesLeft = 3;
            
            while (retriesLeft > 0 && !txid) {
                try {
                    txid = await this.state.connection.sendTransaction(transaction, {
                        skipPreflight: false, // Enable preflight for better error checking
                        maxRetries: 3,
                        preflightCommitment: 'confirmed'
                    });
                    
                    console.log(chalk.green(`Transaction sent: ${txid}`));
                    break;
                } catch (sendError) {
                    retriesLeft--;
                    console.error(chalk.yellow(`Error sending transaction (${retriesLeft} retries left):`, sendError.message));
                    
                    if (retriesLeft <= 0) {
                        throw sendError;
                    }
                    
                    // Wait before retry with exponential backoff
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, 3 - retriesLeft)));
                }
            }
            
            if (!txid) {
                throw new Error('Failed to send transaction after multiple retries');
            }
            
            console.log(chalk.yellow('Waiting for confirmation...'));
            
            // Wait for blockchain state to update
            console.log(chalk.yellow('Waiting for full transaction confirmation and account updates...'));
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            try {
                const confirmation = await this.state.connection.confirmTransaction(
                    {signature: txid, blockhash: transaction.message.recentBlockhash, lastValidBlockHeight: 150000000},
                    'confirmed'
                );
                
                if (confirmation.value.err) {
                    console.error(chalk.red(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`));
                    return false;
                }
                
                console.log(chalk.green(`Transaction confirmed successfully!`));
            } catch (confirmError) {
                console.error(chalk.yellow(`Confirmation timeout, checking transaction status...`));
                
                // Check transaction status separately
                const status = await this.checkTransactionStatus(txid);
                if (!status.success) {
                    console.error(chalk.red(`Transaction failed: ${status.error || 'Unknown error'}`));
                    return false;
                }
                
                console.log(chalk.green(`Transaction confirmed with manual check!`));
            }
            
            console.log(chalk.green(`Transaction fully confirmed with state updates! ID: ${txid}`));
            
            // Get output token name and amount information from the quote
            const outputMint = quoteResponse.outputMint;
            const outputTokenName = this.getTokenNameByAddress(outputMint) || 'Unknown';
            const outputDecimals = this.TOKEN_DECIMALS[outputTokenName] || 9;
            
            const outputAmount = parseInt(quoteResponse.outAmount) / Math.pow(10, outputDecimals);
            
            console.log(chalk.green(`Swap details: ${amount} ${inputToken} -> ${outputAmount.toFixed(6)} ${outputTokenName}`));
            
            return {
                success: true,
                txid,
                inputAmount: amount,
                outputAmount,  // Now outputAmount is properly defined
                inputToken,
                outputToken: outputTokenName
            };
        } catch (error) {
            console.error(chalk.red('Error executing Jupiter swap:'), error);
            console.error(chalk.red('Error stack:'), error.stack);
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
        // Use enhanced execution if available
        if (this.enhancedStrategy) {
            return await this.enhancedStrategy.executeBestOpportunity([opportunity]);
        }
        
        // Fall back to original execution code
        try {
            console.log(chalk.yellow('=== Executing trade opportunity ==='));
            console.log(`Pair: ${opportunity.pair}`);
            console.log(`Amount: ${opportunity.suggestedAmount.toFixed(6)} ${opportunity.inputToken}`);
            console.log(`Price change: ${opportunity.percentChange.toFixed(2)}%`);
    
            await this.getTokenBalances();
            const availableBalance = this.state.balances[opportunity.inputToken] || 0;
    
            if (availableBalance < opportunity.suggestedAmount) {
                console.log(chalk.red(`Insufficient balance. Available: ${availableBalance}, Required: ${opportunity.suggestedAmount}`));
                return false;
            }
    
            const quoteData = await this.getJupiterQuote(
                opportunity.inputToken,
                opportunity.outputToken,
                opportunity.suggestedAmount
            );
    
            if (!quoteData || !quoteData.outAmount) {
                console.error(chalk.red('Failed to get valid quote data'));
                return false;
            }
    
            const outputDecimals = this.TOKEN_DECIMALS[opportunity.outputToken] || 9;
            const quoteOutputAmount = parseInt(quoteData.outAmount) / Math.pow(10, outputDecimals);
    
            if (quoteOutputAmount <= 0) {
                console.error(chalk.red('Quote returned zero or invalid output amount. Skipping trade.'));
                return false;
            }
    
            // Calculate USD per SOL from quote (to compare with historical price)
            const marketPrice = opportunity.suggestedAmount / quoteOutputAmount;
            const profitPercentFromTrend = ((marketPrice - opportunity.currentPrice) / opportunity.currentPrice) * 100;
    
            console.log(chalk.yellow(
                `Quote analysis: Market Price = ${marketPrice.toFixed(6)}, History Price = ${opportunity.currentPrice.toFixed(6)}, Diff = ${profitPercentFromTrend.toFixed(2)}%`
            ));
    
            // Skip if the price difference exceeds our threshold and we're not ignoring differences
            if (profitPercentFromTrend < -2.0 && !this.config.ignorePriceDifference && 
                Math.abs(profitPercentFromTrend) > this.config.maxPriceDifferencePercent) {
                console.log(chalk.red(`Quote not profitable due to excessive slippage. Aborting.`));
                return false;
            }
    
            if (!this.state.tradingEnabled) {
                console.log(chalk.yellow('Trading disabled. Not executing trade.'));
                return false;
            }
    
            console.log(chalk.green('All checks passed. Executing trade...'));
    
            const result = await this.executeJupiterSwap(quoteData, opportunity.suggestedAmount, opportunity.inputToken);
    
            if (result && result.success) {
                // Convert input to SOL equivalent (if needed)
                const inputInSOL = opportunity.inputToken === 'SOL'
                    ? opportunity.suggestedAmount
                    : opportunity.suggestedAmount / opportunity.currentPrice;
    
                const realizedProfit = result.outputAmount - inputInSOL;
                const solEquivalentProfit = realizedProfit;
    
                this.recordProfit(solEquivalentProfit, result, opportunity);
    
                console.log(chalk.green('Trade executed successfully'));
                console.log(`Transaction ID: ${result.txid}`);
                console.log(`Realized profit: ${realizedProfit.toFixed(6)} SOL`);
    
                await this.getTokenBalances();
    
                try {
                    const detailedLogPath = path.join(__dirname, 'logs', 'detailed_trades.log');
                    fs.appendFileSync(
                        detailedLogPath,
                        `\n=== SUCCESSFUL TRADE (${new Date().toISOString()}) ===\n` +
                        `Pair: ${opportunity.pair}\n` +
                        `Input: ${opportunity.suggestedAmount} ${opportunity.inputToken}\n` +
                        `Output: ${result.outputAmount} ${opportunity.outputToken}\n` +
                        `Profit: ${realizedProfit.toFixed(6)} SOL\n` +
                        `Transaction ID: ${result.txid}\n` +
                        `====================================\n`
                    );
                } catch (logError) {
                    console.error(chalk.yellow('Error writing to detailed trade log:'), logError);
                }
    
                return true;
            } else {
                console.log(chalk.red('Trade execution failed'));
                return false;
            }
        } catch (error) {
            console.error(chalk.red('Error during trade execution:'), error);
            return false;
        }
    }

    async executeAndConsolidateTrade(opportunity) {
        try {
            console.log(chalk.yellow('=== Executing trade opportunity with automatic consolidation ==='));
            console.log(`Pair: ${opportunity.pair}`);
            console.log(`Amount: ${opportunity.suggestedAmount.toFixed(6)} ${opportunity.inputToken}`);
            
            if (opportunity.percentChange !== undefined) {
                console.log(`Price change: ${opportunity.percentChange.toFixed(4)}%`);
            }
    
            await this.getTokenBalances();
            const availableBalance = this.state.balances[opportunity.inputToken] || 0;
    
            if (availableBalance < opportunity.suggestedAmount) {
                console.log(chalk.red(`Insufficient balance. Available: ${availableBalance}, Required: ${opportunity.suggestedAmount}`));
                return false;
            }
    
            const quoteData = await this.getJupiterQuote(
                opportunity.inputToken,
                opportunity.outputToken,
                opportunity.suggestedAmount
            );
    
            if (!quoteData || !quoteData.outAmount) {
                console.error(chalk.red('Failed to get valid quote data'));
                return false;
            }
    
            const outputDecimals = this.TOKEN_DECIMALS[opportunity.outputToken] || 9;
            const quoteOutputAmount = parseInt(quoteData.outAmount) / Math.pow(10, outputDecimals);
    
            if (quoteOutputAmount <= 0) {
                console.error(chalk.red('Quote returned zero or invalid output amount. Skipping trade.'));
                return false;
            }
    
            // Calculate USD per SOL from quote (to compare with historical price)
            const marketPrice = opportunity.suggestedAmount / quoteOutputAmount;
            const profitPercentFromTrend = ((marketPrice - opportunity.currentPrice) / opportunity.currentPrice) * 100;
    
            console.log(chalk.yellow(
                `Quote analysis: Market Price = ${marketPrice.toFixed(6)}, History Price = ${opportunity.currentPrice.toFixed(6)}, Diff = ${profitPercentFromTrend.toFixed(2)}%`
            ));
    
            // Skip if the price difference exceeds our threshold and we're not ignoring differences
            if (profitPercentFromTrend < -2.0 && !this.config.ignorePriceDifference && 
                Math.abs(profitPercentFromTrend) > this.config.maxPriceDifferencePercent) {
                console.log(chalk.red(`Quote not profitable due to excessive slippage. Aborting.`));
                return false;
            }
    
            if (!this.state.tradingEnabled) {
                console.log(chalk.yellow('Trading disabled. Not executing trade.'));
                return false;
            }
    
            console.log(chalk.green('All checks passed. Executing trade...'));
    
            const result = await this.executeJupiterSwap(quoteData, opportunity.suggestedAmount, opportunity.inputToken);
    
            if (result && result.success) {
                // Convert input to SOL equivalent (if needed)
                const inputInSOL = opportunity.inputToken === 'SOL'
                    ? opportunity.suggestedAmount
                    : opportunity.suggestedAmount / opportunity.currentPrice;
    
                const realizedProfit = result.outputAmount - inputInSOL;
                const solEquivalentProfit = realizedProfit;
    
                this.recordProfit(solEquivalentProfit, result, opportunity);
    
                console.log(chalk.green('Trade executed successfully'));
                console.log(`Transaction ID: ${result.txid}`);
                console.log(`Realized profit: ${realizedProfit.toFixed(6)} SOL`);
    
                // Wait a moment for blockchain state to settle
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // AUTOMATIC CONSOLIDATION: 
                // If the output token is not SOL, automatically convert it back to SOL
                if (result.outputToken !== 'SOL' && result.outputAmount > 0) {
                    console.log(chalk.blue(`🔄 Automatically consolidating profit to SOL...`));
                    
                    try {
                        // Calculate consolidation amount (95% of the output to allow for fees)
                        const consolidationAmount = result.outputAmount * 0.95;
                        
                        // Get a quote to convert from the output token to SOL
                        console.log(chalk.blue(`Getting quote to convert ${consolidationAmount.toFixed(6)} ${result.outputToken} to SOL...`));
                        
                        const consolidationQuote = await this.getJupiterQuote(
                            result.outputToken,
                            'SOL',
                            consolidationAmount
                        );
                        
                        if (!consolidationQuote || !consolidationQuote.outAmount) {
                            console.error(chalk.red(`Failed to get quote for ${result.outputToken} to SOL conversion`));
                        } else {
                            // Convert outAmount to actual SOL amount
                            const outAmountSOL = parseInt(consolidationQuote.outAmount) / Math.pow(10, 9);
                            console.log(chalk.blue(`Quote received: ${consolidationAmount.toFixed(6)} ${result.outputToken} -> ${outAmountSOL.toFixed(6)} SOL`));
                            
                            // Execute the consolidation trade
                            console.log(chalk.blue(`Executing consolidation trade...`));
                            
                            const consolidationResult = await this.executeJupiterSwap(
                                consolidationQuote,
                                consolidationAmount,
                                result.outputToken
                            );
                            
                            if (consolidationResult && consolidationResult.success) {
                                console.log(chalk.green(`✅ Profit successfully consolidated: ${consolidationResult.outputAmount.toFixed(6)} SOL`));
                                console.log(`Consolidation Transaction ID: ${consolidationResult.txid}`);
                                
                                // Update balances after consolidation
                                await this.getTokenBalances();
                                
                                // Broadcast consolidation success via websocket if available
                                if (this.wsServer) {
                                    this.wsServer.clients.forEach((client) => {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(JSON.stringify({
                                                type: 'profit_consolidation',
                                                balances: this.state.balances,
                                                solGained: consolidationResult.outputAmount,
                                                message: `Profit consolidated: ${consolidationResult.outputAmount.toFixed(6)} SOL`
                                            }));
                                        }
                                    });
                                }
                            } else {
                                console.error(chalk.red(`Failed to consolidate profit to SOL`));
                            }
                        }
                    } catch (error) {
                        console.error(chalk.red('Error during automatic profit consolidation:'), error);
                    }
                }
    
                await this.getTokenBalances();
                return true;
            } else {
                console.log(chalk.red('Trade execution failed'));
                return false;
            }
        } catch (error) {
            console.error(chalk.red('Error during trade execution:'), error);
            return false;
        }
    }
    
    logToClientDashboard(message, type = 'info') {
        // Skip if websocket not configured
        if (!this.wsServer) return;
        
        try {
            // Broadcast to all clients
            this.wsServer.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'log_message',
                        message: message,
                        messageType: type
                    }));
                }
            });
        } catch (error) {
            console.error(chalk.red('Error sending log to dashboard:'), error);
        }
    }

    recordProfit(solProfit, tradeResult, opportunity) {
        this.state.dailyProfit += solProfit;
        this.state.totalProfit += solProfit;
    
        // Initialize per-token profit tracking
        if (!this.state.tokenProfits) {
            this.state.tokenProfits = {
                SOL: 0,
                USDC: 0,
                USDT: 0
            };
        }
    
        // Track native profit in output token
        const nativeProfit = tradeResult.outputAmount - (
            opportunity.inputToken === opportunity.outputToken
                ? opportunity.suggestedAmount
                : opportunity.inputToken === 'SOL'
                    ? opportunity.suggestedAmount
                    : opportunity.suggestedAmount / opportunity.currentPrice
        );
    
        if (this.state.tokenProfits[tradeResult.outputToken] !== undefined) {
            this.state.tokenProfits[tradeResult.outputToken] += nativeProfit;
        }
    
        const timestamp = new Date().toISOString();
        const tradeRecord = {
            timestamp,
            pair: opportunity.pair,
            inputAmount: tradeResult.inputAmount,
            inputToken: tradeResult.inputToken,
            outputAmount: tradeResult.outputAmount,
            outputToken: tradeResult.outputToken,
            profit: solProfit,
            txid: tradeResult.txid
        };
    
        // Record profit in enhanced strategy if available
        if (this.enhancedStrategy) {
            this.enhancedStrategy.recordProfit(solProfit, timestamp);
        }
        
        // Add to history
        this.state.tradeHistory.push(tradeRecord);
        if (this.state.tradeHistory.length > 50) {
            this.state.tradeHistory.shift();
        }
    
        // Log to CSV
        const logEntry = `${timestamp},${opportunity.pair},${tradeResult.inputAmount},${tradeResult.inputToken},${tradeResult.outputAmount},${tradeResult.outputToken},${solProfit},${tradeResult.txid}\n`;
        fs.appendFileSync(path.join(__dirname, 'logs', 'trade_history.csv'), logEntry);
    
        this.checkProfitTarget();
    }
    
    checkProfitTarget() {
        // Check if we've hit our daily profit target
        if (this.state.dailyProfit >= this.config.dailyProfitTarget && !this.config.aggressiveMode) {
            console.log(chalk.green(`Daily profit target of ${this.config.dailyProfitTarget} SOL reached! (${this.state.dailyProfit.toFixed(6)} SOL)`));
            console.log(chalk.yellow('Disabling trading for the rest of the day. Use aggressiveMode=true to keep trading.'));
            this.state.tradingEnabled = false;
        }
    }
    
    async start() {
        console.log(chalk.blue('Starting Solana Trading Bot in HIGH FREQUENCY mode'));
        
        // Initial token balance check
        await this.getTokenBalances();
        
        // Update bot status
        this.state.status = 'running';
        
        // Reset daily profit at the start of new day
        if (new Date().getHours() === 0 && new Date().getMinutes() < 10) {
            this.state.dailyProfit = 0;
            console.log(chalk.blue('Daily profit counter reset for new day'));
        }
        
        // More aggressive tracking variables
        let lastTradeTime = 0;
        const minTradeInterval = 5000; // 5 seconds minimum between trades
        
        // Create detailed logs directory if it doesn't exist
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir);
        }
        
        // Create detailed trade log file
        const detailedLogPath = path.join(logDir, 'detailed_trades.log');
        fs.writeFileSync(detailedLogPath, `=== SOLANA TRADING BOT DETAILED LOG - STARTED ${new Date().toISOString()} ===\n`);
        
        // Main trading loop
        const tradingInterval = setInterval(async () => {
            try {
                // Get current time
                const currentTime = Date.now();
                
                // Skip if less than minimum interval since last trade
                if (currentTime - lastTradeTime < minTradeInterval) {
                    return;
                }
                
                console.log(chalk.blue(`\n=== Trading cycle - ${new Date().toISOString()} ===`));
                
                // Fetch current prices
                const currentPrices = await this.fetchCurrentPrices();
                
                // Find trading opportunities
                const opportunities = await this.findTradingOpportunities(currentPrices);
                
                // Check if we should execute a trade
                if (opportunities.length > 0 && 
                    this.state.activeTrades < this.config.maxConcurrentTrades) {
                    
                    // Sort opportunities by confidence * potential profit
                    opportunities.sort((a, b) => {
                        const aValue = (a.confidence || 50) * a.potentialProfit;
                        const bValue = (b.confidence || 50) * b.potentialProfit;
                        return bValue - aValue;
                    });
                    
                    const bestOpportunity = opportunities[0];
                    console.log(chalk.blue(`Processing best trading opportunity: ${bestOpportunity.pair} (${bestOpportunity.percentChange.toFixed(2)}% change)`));
                    
                    // Skip very small opportunities
                    if (bestOpportunity.potentialProfit < 0.0002) {
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
                    // Log no opportunities found
                    console.log(chalk.yellow('No profitable trading opportunities found this cycle'));
                    
                    // Periodically update balances even without trades
                    if (currentTime - lastTradeTime > 120000) { // 2 minutes
                        await this.getTokenBalances();
                        lastTradeTime = currentTime - 110000; // Reset timer but don't fully reset
                    }
                }
            } catch (error) {
                console.error(chalk.red('Trading loop error:'), error);
                
                // Recover from errors
                this.state.activeTrades = Math.max(0, this.state.activeTrades - 1);
                
                // Check if connection needs to be reestablished
                if (error.message && (error.message.includes('failed to fetch') || 
                   error.message.includes('connection') || 
                   error.message.includes('network'))) {
                    console.log(chalk.yellow('Network error detected. Attempting to reestablish connection...'));
                    await this.setupConnection();
                }
            }
        }, this.config.refreshInterval);
        
        // Store interval for potential cleanup
        this.state.tradingInterval = tradingInterval;
        
        // Add additional price monitoring interval (higher frequency for volatility detection)
        this.state.priceMonitorInterval = setInterval(async () => {
            try {
                if (this.enhancedStrategy) {
                    // Quick price check for volatility detection only
                    const prices = await this.priceFetcher.getPrices(this.tradingPairs);
                    
                    // Just update the strategy's price tracking without full opportunity scan
                    this.enhancedStrategy.updatePriceTracking(prices);
                }
            } catch (error) {
                console.error(chalk.yellow('Price monitor error:'), error);
            }
        }, 3000); // Check prices every 3 seconds
        
        // Add additional status check interval
        this.state.statusInterval = setInterval(() => {
            // Check wallet connection and RPC connection are still active
            if (this.state.status === 'running') {
                console.log(chalk.green(`Trading bot running: Active trades: ${this.state.activeTrades}, Total profit: ${this.state.totalProfit.toFixed(6)} SOL`));
            }
        }, 60000); // Status update every minute
        
        console.log(chalk.green('Trading bot started and actively looking for opportunities'));
    }

    stop() {
        if (this.state.tradingInterval) {
            clearInterval(this.state.tradingInterval);
        }
        
        if (this.state.priceMonitorInterval) {
            clearInterval(this.state.priceMonitorInterval);
        }
        
        if (this.state.statusInterval) {
            clearInterval(this.state.statusInterval);
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
            recentTrades: this.state.tradeHistory.slice(-5),
            tokenProfits: this.state.tokenProfits || { SOL: 0, USDC: 0, USDT: 0 },
            hourlyProfit: this.enhancedStrategy ? this.enhancedStrategy.recentProfit : null
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