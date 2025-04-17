const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const chalk = require('chalk');

// Disable debugger to prevent "Debugger attached" messages
process.env.NODE_OPTIONS = '--no-deprecation';

// Load environment variables from parent directory if this is in src/
let envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  envPath = path.join(__dirname, '..', '.env');
}
dotenv.config({ path: envPath });

// Handle BigInt serialization for JSON
BigInt.prototype.toJSON = function() { return this.toString() };

// Import Trading Bot Core - handle both direct and relative imports
let SolanaTradingBot;
try {
  SolanaTradingBot = require('./index');
} catch (err) {
  try {
    SolanaTradingBot = require(path.join(__dirname, 'index'));
  } catch (err2) {
    console.error(chalk.red('Failed to import trading bot core:'), err2);
    process.exit(1);
  }
}

class TradingBotServer {
    constructor() {
        console.log(chalk.blue('Initializing Trading Bot Server...'));
        
        // Express and HTTP server setup
        this.app = express();
        this.httpServer = http.createServer(this.app);
        
        // WebSocket server
        this.wsServer = new WebSocket.Server({ server: this.httpServer });

        // Server state
        this.serverState = {
            status: 'initializing',
            wallet: {
                connected: false,
                publicKey: null,
                keypair: null
            },
            botRunning: false,
            balances: {},
            config: this.loadConfiguration(),
            recentTrades: [],
            activeTrades: 0,
            tradingPairs: [
                'SOL/USDC', 
                'SOL/USDT', 
                'USDC/SOL', 
                'USDT/SOL',
                'mSOL/SOL',
                'SOL/mSOL'
            ]
        };

        // Trading Bot instance
        this.tradingBot = null;

        // Profit tracking
        this.profitTracking = {
            profits: {
                SOL: 0,
                USDC: 0,
                USDT: 0,
                mSOL: 0
            },
            tradeHistory: [],
            startTime: Date.now(),
            totalTrades: 0
        };

        // Update intervals
        this.intervals = {
            botUpdate: null,
            balanceUpdate: null
        };
        
        // Setup everything
        this.setupLogs();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocketHandlers();
        this.setupErrorHandling();
        
        console.log(chalk.green('Server initialization completed.'));
    }

    loadConfiguration() {
        console.log(chalk.blue('Loading configuration...'));
        try {
            return {
                minProfitPercentage: parseFloat(process.env.MIN_PROFIT_PERCENTAGE) || 0.3,
                maxSlippage: parseInt(process.env.MAX_SLIPPAGE_BPS) || 100,
                refreshInterval: parseInt(process.env.REFRESH_INTERVAL) || 15000,
                initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 0.1,
                dailyProfitTarget: parseFloat(process.env.DAILY_PROFIT_TARGET) || 2.0,
                minTradeSize: parseFloat(process.env.MIN_TRADE_SIZE) || 0.05,
                maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES) || 3,
                aggressiveMode: process.env.AGGRESSIVE_MODE === 'true'
            };
        } catch (error) {
            console.error(chalk.red('Error loading configuration:'), error);
            // Return defaults if config loading fails
            return {
                minProfitPercentage: 0.3,
                maxSlippage: 100,
                refreshInterval: 15000,
                initialBalance: 0.1,
                dailyProfitTarget: 2.0,
                minTradeSize: 0.05,
                maxConcurrentTrades: 3,
                aggressiveMode: false
            };
        }
    }

    setupLogs() {
        // Create logs directory if it doesn't exist
        const logDir = path.join(__dirname, 'logs');
        try {
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir);
            }
            
            // Create server log file
            const serverLogPath = path.join(logDir, 'server.log');
            if (!fs.existsSync(serverLogPath)) {
                fs.writeFileSync(serverLogPath, 'timestamp,event,details\n');
            }
            
            // Create trade log file
            const tradeLogPath = path.join(logDir, 'trades.csv');
            if (!fs.existsSync(tradeLogPath)) {
                fs.writeFileSync(tradeLogPath, 'timestamp,pair,input_amount,input_token,output_amount,output_token,profit,txid\n');
            }
            
            // Log server start
            this.logEvent('server_start', 'Server started');
        } catch (error) {
            console.error(chalk.red('Error setting up logs:'), error);
            // Continue even if log setup fails
        }
    }

    logEvent(event, details = '') {
        try {
            const timestamp = new Date().toISOString();
            const logEntry = `${timestamp},${event},${details.replace(/,/g, ';')}\n`;
            fs.appendFileSync(path.join(__dirname, 'logs', 'server.log'), logEntry);
        } catch (error) {
            console.error('Error writing to log:', error);
        }
    }

    setupMiddleware() {
        // JSON parsing and logging
        this.app.use(express.json());
        this.app.use((req, res, next) => {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
            next();
        });

        // CORS headers for API endpoints
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            next();
        });

        // Check for public directory
        const publicDir = path.join(__dirname, 'public');
        try {
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir);
                console.log(chalk.yellow('Created missing public directory'));
            }
            
            // Serve static files
            this.app.use(express.static(publicDir));
        } catch (error) {
            console.error(chalk.red('Error setting up public directory:'), error);
            // Continue without static file serving
        }
    }

    setupRoutes() {
        // Serve index.html
        this.app.get('/', (req, res) => {
            const indexPath = path.join(__dirname, 'public', 'index.html');
            if (fs.existsSync(indexPath)) {
                res.sendFile(indexPath);
            } else {
                res.send('<html><body><h1>Solana Trading Bot</h1><p>Dashboard not found. Please check your installation.</p></body></html>');
            }
        });

        // API endpoint for bot state
        this.app.get('/api/bot-state', (req, res) => {
            res.json({
                status: this.serverState.status,
                botRunning: this.serverState.botRunning,
                wallet: {
                    connected: this.serverState.wallet.connected,
                    publicKey: this.serverState.wallet.publicKey
                },
                balances: this.serverState.balances,
                profits: this.profitTracking.profits,
                recentTrades: this.profitTracking.tradeHistory.slice(-5),
                totalTrades: this.profitTracking.totalTrades,
                activeTrades: this.serverState.activeTrades,
                config: this.serverState.config
            });
        });
        
        // API endpoint for trade history
        this.app.get('/api/trade-history', (req, res) => {
            // Read from trade log file
            try {
                const tradeLogPath = path.join(__dirname, 'logs', 'trades.csv');
                const tradeData = fs.readFileSync(tradeLogPath, 'utf8');
                
                // Convert CSV to JSON
                const lines = tradeData.split('\n');
                const headers = lines[0].split(',');
                
                const trades = lines.slice(1)
                    .filter(line => line.trim())
                    .map(line => {
                        const values = line.split(',');
                        const trade = {};
                        
                        headers.forEach((header, index) => {
                            trade[header] = values[index];
                        });
                        
                        return trade;
                    });
                
                res.json(trades);
            } catch (error) {
                console.error('Error reading trade history:', error);
                res.status(500).json({ error: 'Failed to read trade history' });
            }
        });
        
        // API endpoint to update configuration
        this.app.post('/api/config', (req, res) => {
            try {
                const newConfig = req.body;
                
                // Validate config values
                if (typeof newConfig.minProfitPercentage === 'number') {
                    this.serverState.config.minProfitPercentage = newConfig.minProfitPercentage;
                }
                
                if (typeof newConfig.maxSlippage === 'number') {
                    this.serverState.config.maxSlippage = newConfig.maxSlippage;
                }
                
                if (typeof newConfig.refreshInterval === 'number') {
                    this.serverState.config.refreshInterval = newConfig.refreshInterval;
                }
                
                if (typeof newConfig.minTradeSize === 'number') {
                    this.serverState.config.minTradeSize = newConfig.minTradeSize;
                }
                
                if (typeof newConfig.maxConcurrentTrades === 'number') {
                    this.serverState.config.maxConcurrentTrades = newConfig.maxConcurrentTrades;
                }
                
                if (typeof newConfig.aggressiveMode === 'boolean') {
                    this.serverState.config.aggressiveMode = newConfig.aggressiveMode;
                }
                
                // Update trading bot config if running
                if (this.tradingBot) {
                    this.tradingBot.config = {...this.serverState.config};
                }
                
                // Broadcast config update
                this.broadcastMessage({
                    type: 'config_update',
                    config: this.serverState.config
                });
                
                res.json({ success: true, config: this.serverState.config });
            } catch (error) {
                console.error(chalk.red('Error updating config:'), error);
                res.status(500).json({ error: 'Failed to update configuration' });
            }
        });
        
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                uptime: process.uptime(),
                timestamp: Date.now()
            });
        });
    }

    setupErrorHandling() {
        // Global error handler for Express
        this.app.use((err, req, res, next) => {
            console.error('Unhandled Express Error:', err);
            this.logEvent('express_error', err.message);
            
            res.status(500).json({
                error: 'Internal Server Error',
                message: err.message
            });
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('UNCAUGHT EXCEPTION:', error);
            this.logEvent('uncaught_exception', error.message);
            
            // Attempt graceful shutdown
            this.stop();
            
            // Give time for logs to be written before exiting
            setTimeout(() => process.exit(1), 1000);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            console.error('UNHANDLED PROMISE REJECTION:', reason);
            this.logEvent('unhandled_rejection', reason ? reason.toString() : 'Unknown reason');
        });
    }

    setupWebSocketHandlers() {
        this.wsServer.on('connection', (ws) => {
            console.log('New WebSocket connection');
            this.logEvent('websocket_connection', 'New client connected');

            // Send initial state
            this.sendInitialState(ws);

            // Setup ping/pong for connection health check
            ws.isAlive = true;
            ws.on('pong', () => {
                ws.isAlive = true;
            });

            // Handle incoming messages
            ws.on('message', async (message) => {
                try {
                    const parsedMessage = JSON.parse(message.toString());
                    await this.handleWebSocketMessage(parsedMessage, ws);
                } catch (error) {
                    console.error('WebSocket message error:', error);
                    this.logEvent('websocket_message_error', error.message);
                }
            });

            // Handle connection closure
            ws.on('close', () => {
                console.log('WebSocket disconnected');
                this.logEvent('websocket_disconnection', 'Client disconnected');
            });

            // WebSocket error handling
            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.logEvent('websocket_error', error.message);
            });
        });

        // Connection health check interval
        const pingInterval = setInterval(() => {
            this.wsServer.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log('Terminating inactive WebSocket connection');
                    return ws.terminate();
                }
                
                ws.isAlive = false;
                ws.ping(() => {});
            });
        }, 30000); // Check every 30 seconds

        // Clear interval on server close
        this.wsServer.on('close', () => {
            clearInterval(pingInterval);
        });
    }

    sendInitialState(ws) {
        try {
            // Send initial wallet and bot state
            ws.send(JSON.stringify({
                type: 'wallet_state',
                data: {
                    connected: this.serverState.wallet.connected,
                    publicKey: this.serverState.wallet.publicKey
                }
            }));

            // Send configuration
            ws.send(JSON.stringify({
                type: 'config_update',
                config: this.serverState.config
            }));

            // Send bot state if running
            if (this.serverState.botRunning) {
                ws.send(JSON.stringify({
                    type: 'bot_status',
                    status: 'running'
                }));

                // Send current balance information
                ws.send(JSON.stringify({
                    type: 'balance_update',
                    balances: this.serverState.balances
                }));
                
                // Send profit information
                ws.send(JSON.stringify({
                    type: 'profit_update',
                    profits: this.profitTracking.profits
                }));
                
                // Send recent trades
                ws.send(JSON.stringify({
                    type: 'trades_update',
                    trades: this.profitTracking.tradeHistory.slice(-5)
                }));
            }
        } catch (error) {
            console.error('Error sending initial state:', error);
        }
    }

    async handleWebSocketMessage(message, ws) {
        try {
            switch(message.type) {
                case 'connect_wallet':
                    await this.connectWallet(ws);
                    break;
        
                case 'start_bot':
                    await this.startTradingBot(ws);
                    break;
        
                case 'stop_bot':
                    this.stopTradingBot(ws);
                    break;
                    
                case 'update_config':
                    this.updateConfig(message.config, ws);
                    break;
        
                case 'health_check':
                    // Respond to keep-alive message
                    ws.send(JSON.stringify({
                        type: 'health_status',
                        status: 'ok',
                        timestamp: Date.now()
                    }));
                    break;
        
                default:
                    console.log('Unhandled WebSocket message:', message);
            }
        } catch (error) {
            console.error('Error handling WebSocket message:', error);
            
            // Send error back to client
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: error.message || 'Unknown error'
                }));
            } catch (sendError) {
                console.error('Error sending error response:', sendError);
            }
        }
    }

    async connectWallet(ws) {
        try {
            console.log(chalk.blue('Connecting wallet...'));
            this.logEvent('wallet_connect_attempt', 'Attempting to connect wallet');
            
            // Load wallet from private key in environment
            if (!process.env.PRIVATE_KEY) {
                throw new Error("Private key not found in environment variables");
            }
            
            // Support both array and base58 encoded private key
            let secretKey;
            try {
                // Try parsing as JSON array
                const privateKeyArray = JSON.parse(process.env.PRIVATE_KEY);
                secretKey = Uint8Array.from(privateKeyArray);
            } catch (parseError) {
                // Log error without exposing private key
                console.log('Failed to parse private key as JSON array, trying base58 format...');
                
                try {
                    // If not JSON array, try base58 decoding
                    secretKey = bs58.decode(process.env.PRIVATE_KEY);
                } catch (bs58Error) {
                    throw new Error('Invalid private key format. Must be a JSON array or base58 encoded string.');
                }
            }
            
            const keypair = Keypair.fromSecretKey(secretKey);
            this.serverState.wallet = {
                connected: true,
                publicKey: keypair.publicKey.toString(),
                keypair: keypair
            };
            
            console.log(chalk.green(`Wallet connected successfully: ${keypair.publicKey.toString()}`));
            this.logEvent('wallet_connected', keypair.publicKey.toString());

            // Set up a connection to check balances
            const connectionRetries = 3;
            let connection = null;
            
            // Try multiple RPC endpoints
            const rpcEndpoints = [
                process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
                'https://solana-api.projectserum.com',
                'https://rpc.ankr.com/solana'
            ];
            
            let connectionSuccessful = false;
            
            for (let i = 0; i < rpcEndpoints.length; i++) {
                try {
                    console.log(chalk.blue(`Trying RPC endpoint: ${rpcEndpoints[i]}`));
                    connection = new Connection(rpcEndpoints[i], 'confirmed');
                    // Test connection
                    await connection.getBlockHeight();
                    console.log(chalk.green(`Connected to Solana RPC: ${rpcEndpoints[i]}`));
                    connectionSuccessful = true;
                    break;
                } catch (error) {
                    console.error(chalk.yellow(`Failed to connect to RPC ${rpcEndpoints[i]}:`, error.message));
                    
                    if (i === rpcEndpoints.length - 1) {
                        throw new Error("Failed to connect to any Solana RPC endpoint");
                    }
                }
            }
            
            if (!connectionSuccessful) {
                throw new Error("Failed to connect to any Solana RPC endpoint");
            }
            
            // Get wallet balances
            let balances = {};
            let retryCount = 0;
            
            while (retryCount < connectionRetries) {
                try {
                    // Get SOL balance
                    const solBalance = await connection.getBalance(keypair.publicKey);
                    balances['SOL'] = solBalance / 1e9;
                    
                    // Get token accounts
                    try {
                        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                            keypair.publicKey,
                            { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
                        );
                        
                        // Process token accounts
                        for (const { account } of tokenAccounts.value) {
                            const mint = account.data.parsed.info.mint;
                            const amount = account.data.parsed.info.tokenAmount.uiAmount;
                            
                            // Map to known tokens
                            if (mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
                                balances['USDC'] = amount;
                            } else if (mint === 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB') {
                                balances['USDT'] = amount;
                            } else if (mint === 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So') {
                                balances['mSOL'] = amount;
                            }
                        }
                    } catch (tokenError) {
                        console.error(chalk.yellow('Error fetching token accounts:', tokenError.message));
                        // Continue with SOL balance only
                    }
                    
                    break;
                } catch (error) {
                    console.error(chalk.yellow(`Error fetching balances (attempt ${retryCount + 1}/${connectionRetries}):`, error.message));
                    retryCount++;
                    
                    // Use dummy values if all retries fail
                    if (retryCount >= connectionRetries) {
                        console.warn(chalk.yellow('Using default balances after failed attempts'));
                        balances = {
                            'SOL': 0.1,
                            'USDC': 10,
                            'USDT': 10
                        };
                    } else {
                        // Wait before retry
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }
            
            this.serverState.balances = balances;
            
            // Broadcast wallet connection success
            this.broadcastMessage({
                type: 'wallet_connected',
                publicKey: keypair.publicKey.toString()
            });

            // Also send balances update
            this.broadcastMessage({
                type: 'balance_update',
                balances: this.serverState.balances
            });

            console.log(chalk.green('Wallet connected with balances:'), 
                Object.entries(balances).map(([token, amount]) => 
                    `${token}: ${amount.toFixed(4)}`
                ).join(', ')
            );
            
            return true;
        } catch (error) {
            console.error(chalk.red('Wallet connection error:'), error);
            this.logEvent('wallet_connection_error', error.message);
            
            // Send error message to client
            ws.send(JSON.stringify({
                type: 'wallet_connection_error',
                error: error.message
            }));
            
            return false;
        }
    }

    updateConfig(newConfig, ws) {
        try {
            // Update config values if valid
            Object.entries(newConfig).forEach(([key, value]) => {
                if (this.serverState.config.hasOwnProperty(key)) {
                    if (typeof value === 'number' && !isNaN(value)) {
                        this.serverState.config[key] = value;
                    } else if (typeof value === 'boolean') {
                        this.serverState.config[key] = value;
                    }
                }
            });
            
            // Update trading bot config if running
            if (this.tradingBot) {
                Object.assign(this.tradingBot.config, this.serverState.config);
            }
            
            console.log(chalk.green('Configuration updated:'), this.serverState.config);
            this.logEvent('config_updated', JSON.stringify(this.serverState.config));
            
            // Broadcast config update
            this.broadcastMessage({
                type: 'config_update',
                config: this.serverState.config
            });
            
            // Send confirmation to the client
            ws.send(JSON.stringify({
                type: 'config_update_success',
                config: this.serverState.config
            }));
        } catch (error) {
            console.error(chalk.red('Config update error:'), error);
            this.logEvent('config_update_error', error.message);
            
            // Send error message to client
            ws.send(JSON.stringify({
                type: 'config_update_error',
                error: error.message
            }));
        }
    }

    async startTradingBot(ws) {
        try {
            // First check if wallet is connected
            if (!this.serverState.wallet.connected) {
                throw new Error("Wallet not connected. Please connect wallet first.");
            }

            // Create a new trading bot instance
            console.log(chalk.blue('Starting Solana Trading Bot...'));
            this.logEvent('bot_start_attempt', 'Attempting to start trading bot');
            
            // Initialize profit tracking
            this.profitTracking = {
                profits: {
                    SOL: 0,
                    USDC: 0,
                    USDT: 0,
                    mSOL: 0
                },
                tradeHistory: [],
                startTime: Date.now(),
                totalTrades: 0
            };
            
            // Create a new bot instance
            try {
                this.tradingBot = new SolanaTradingBot();
            } catch (error) {
                console.error(chalk.red('Failed to create trading bot instance:'), error);
                throw new Error(`Failed to create trading bot: ${error.message}`);
            }
            
            // Update trading bot configuration
            this.tradingBot.config = {
                ...this.tradingBot.config,
                ...this.serverState.config
            };
            
            // Set the bot's wallet to our current wallet
            this.tradingBot.state.wallet = this.serverState.wallet.keypair;
            
            // Apply our trading pair configuration
            this.tradingBot.tradingPairs = this.serverState.tradingPairs;
            
            // Start the bot
            try {
                await this.tradingBot.start();
            } catch (error) {
                console.error(chalk.red('Failed to start trading bot:'), error);
                throw new Error(`Failed to start trading bot: ${error.message}`);
            }
            
            // Update server state
            this.serverState.botRunning = true;
            this.serverState.status = 'running';
            
            // Start the bot updates interval
            this.startBotUpdates();
            
            // Broadcast bot start
            this.broadcastMessage({
                type: 'bot_status',
                status: 'running'
            });
            
            console.log(chalk.green('Trading bot started successfully'));
            this.logEvent('bot_started', 'Trading bot started successfully');
            
            return true;
        } catch (error) {
            console.error(chalk.red('Bot start error:'), error);
            this.logEvent('bot_start_error', error.message);
            
            // Send error message to client
            ws.send(JSON.stringify({
                type: 'bot_start_error',
                error: error.message
            }));
            
            return false;
        }
    }

    stopTradingBot(ws) {
        try {
            console.log(chalk.yellow('Stopping trading bot...'));
            this.logEvent('bot_stop_attempt', 'Attempting to stop trading bot');
            
            // Stop the bot if it exists
            if (this.tradingBot) {
                this.tradingBot.stop();
                this.tradingBot = null;
            }
            
            // Clear all intervals
            Object.values(this.intervals).forEach(interval => {
                if (interval) clearInterval(interval);
            });

            // Update state
            this.serverState.botRunning = false;
            this.serverState.status = 'stopped';
            this.serverState.activeTrades = 0;

            // Broadcast bot stop
            this.broadcastMessage({
                type: 'bot_status',
                status: 'stopped'
            });

            console.log(chalk.yellow('Trading bot stopped'));
            this.logEvent('bot_stopped', 'Trading bot stopped successfully');
            
            return true;
        } catch (error) {
            console.error(chalk.red('Bot stop error:'), error);
            this.logEvent('bot_stop_error', error.message);
            
            // Send error message to client
            ws.send(JSON.stringify({
                type: 'bot_stop_error',
                error: error.message
            }));
            
            return false;
        }
    }

    startBotUpdates() {
        // Clear any existing intervals
        if (this.intervals.botUpdate) {
            clearInterval(this.intervals.botUpdate);
        }
        
        if (this.intervals.balanceUpdate) {
            clearInterval(this.intervals.balanceUpdate);
        }
        
        // Set up interval for bot state updates (every 5 seconds)
        this.intervals.botUpdate = setInterval(async () => {
            try {
                // Skip if bot is no longer running
                if (!this.serverState.botRunning || !this.tradingBot) return;
                
                // Get bot performance stats
                const stats = await this.tradingBot.getPerformanceStats();
                
                // Update server state with bot stats
                this.serverState.activeTrades = stats.activeTrades;
                this.serverState.balances = stats.balances;
                
                // Update profit tracking
                this.profitTracking.profits = {
                    SOL: stats.totalProfit || 0,
                    ...this.profitTracking.profits
                };
                
                // Update trade history if new trades exist
                if (stats.recentTrades && stats.recentTrades.length > 0) {
                    // Check for new trades by comparing with our last known trade
                    const lastKnownTrade = this.profitTracking.tradeHistory.length > 0 
                        ? this.profitTracking.tradeHistory[this.profitTracking.tradeHistory.length - 1] 
                        : null;
                    
                    const newTrades = lastKnownTrade 
                        ? stats.recentTrades.filter(trade => 
                            !lastKnownTrade.txid || trade.txid !== lastKnownTrade.txid
                        )
                        : stats.recentTrades;
                    
                    // Add new trades to our history
                    if (newTrades.length > 0) {
                        this.profitTracking.tradeHistory = [
                            ...this.profitTracking.tradeHistory,
                            ...newTrades
                        ];
                        
                        // Trim history to last 100 trades
                        if (this.profitTracking.tradeHistory.length > 100) {
                            this.profitTracking.tradeHistory = this.profitTracking.tradeHistory.slice(-100);
                        }
                        
                        // Update total trades count
                        this.profitTracking.totalTrades += newTrades.length;
                        
                        // Log new trades to the trade log
                        this.logNewTrades(newTrades);
                        
                        // Broadcast trade updates
                        this.broadcastMessage({
                            type: 'trades_update',
                            trades: this.profitTracking.tradeHistory.slice(-5)
                        });
                    }
                }
                
                // Broadcast bot state update
                this.broadcastMessage({
                    type: 'bot_state_update',
                    totalBalance: this.serverState.balances['SOL'] || 0,
                    activeTrades: this.serverState.activeTrades
                });
                
                // Broadcast profit update
                this.broadcastMessage({
                    type: 'profit_update',
                    profits: this.profitTracking.profits
                });
            } catch (error) {
                console.error(chalk.red('Error updating bot state:'), error);
                this.logEvent('bot_update_error', error.message);
            }
        }, 5000);
        
        // Set up interval for balance updates (every 30 seconds)
        this.intervals.balanceUpdate = setInterval(async () => {
            try {
                // Skip if bot is no longer running
                if (!this.serverState.botRunning || !this.tradingBot) return;
                
                // Get updated balances
                const balances = await this.tradingBot.getTokenBalances();
                
                // Update server state
                this.serverState.balances = balances;
                
                // Broadcast balance update
                this.broadcastMessage({
                    type: 'balance_update',
                    balances
                });
            } catch (error) {
                console.error(chalk.red('Error updating balances:'), error);
                this.logEvent('balance_update_error', error.message);
            }
        }, 30000);
    }

    logNewTrades(trades) {
        try {
            const tradeLogPath = path.join(__dirname, 'logs', 'trades.csv');
            
            trades.forEach(trade => {
                const logEntry = `${trade.timestamp},${trade.pair},${trade.inputAmount},${trade.inputToken},${trade.outputAmount},${trade.outputToken},${trade.profit},${trade.txid}\n`;
                fs.appendFileSync(tradeLogPath, logEntry);
            });
        } catch (error) {
            console.error('Error logging trades:', error);
            this.logEvent('trade_log_error', error.message);
        }
    }

    broadcastMessage(message) {
        // Send message to all connected WebSocket clients
        this.wsServer.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(JSON.stringify(message));
                } catch (error) {
                    console.error('Error sending message to client:', error);
                }
            }
        });
    }

    start() {
        const PORT = process.env.HTTP_PORT || 3000;
        const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces
        
        // Start HTTP server with error handling
        try {
            this.httpServer.listen(PORT, HOST, () => {
                console.log(chalk.green(`Server running on http://${HOST}:${PORT}`));
                this.logEvent('server_listening', `Listening on port ${PORT}`);
            });

            // Additional error handling for server start
            this.httpServer.on('error', (error) => {
                console.error(chalk.red('HTTP Server Error:'), error);
                this.logEvent('http_server_error', error.message);
                
                if (error.code === 'EADDRINUSE') {
                    console.error(chalk.red(`Port ${PORT} is already in use. Is another server running?`));
                }
            });
            
            // Update server state
            this.serverState.status = 'ready';
            
            // Add signal handlers for graceful shutdown
            this.setupSignalHandlers();
        } catch (error) {
            console.error(chalk.red('Failed to start server:'), error);
            this.logEvent('server_start_error', error.message);
            process.exit(1);
        }
    }
    
    setupSignalHandlers() {
        // Handle graceful shutdown on SIGINT (Ctrl+C)
        process.on('SIGINT', () => {
            console.log(chalk.yellow('\nReceived SIGINT. Shutting down gracefully...'));
            this.logEvent('shutdown_initiated', 'SIGINT received');
            this.stop();
        });
        
        // Handle graceful shutdown on SIGTERM
        process.on('SIGTERM', () => {
            console.log(chalk.yellow('\nReceived SIGTERM. Shutting down gracefully...'));
            this.logEvent('shutdown_initiated', 'SIGTERM received');
            this.stop();
        });
    }

    stop() {
        console.log(chalk.yellow('Shutting down server...'));
        this.logEvent('server_shutdown', 'Server shutting down');
        
        // Stop trading bot if running
        if (this.serverState.botRunning && this.tradingBot) {
            try {
                this.tradingBot.stop();
                this.tradingBot = null;
            } catch (error) {
                console.error(chalk.red('Error stopping trading bot:'), error);
            }
        }
        
        // Clear all intervals
        Object.values(this.intervals).forEach(interval => {
            if (interval) clearInterval(interval);
        });
        
        // Close WebSocket server
        if (this.wsServer) {
            try {
                this.wsServer.close();
            } catch (error) {
                console.error(chalk.red('Error closing WebSocket server:'), error);
            }
        }
        
        // Close HTTP server
        if (this.httpServer) {
            try {
                this.httpServer.close(() => {
                    console.log(chalk.green('HTTP server closed'));
                    // Exit after a short delay to allow logs to be written
                    setTimeout(() => process.exit(0), 500);
                });
            } catch (error) {
                console.error(chalk.red('Error closing HTTP server:'), error);
                // Force exit if closing fails
                setTimeout(() => process.exit(1), 500);
            }
        } else {
            // Force exit if no HTTP server
            setTimeout(() => process.exit(0), 500);
        }
    }
}

// Export the server class
module.exports = TradingBotServer;

// If run directly, start the server
if (require.main === module) {
    console.log(chalk.blue('Starting Solana Trading Bot Server...'));
    
    // Disable any debugger
    process.removeAllListeners('SIGUSR1');
    
    try {
        const server = new TradingBotServer();
        server.start();
        console.log(chalk.green('Server started successfully!'));
    } catch (error) {
        console.error(chalk.red('Failed to start server:'), error);
        process.exit(1);
    }
}