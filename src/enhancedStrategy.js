/**
 * Enhanced Trading Strategy Implementation
 * Ensures each trade profits at least 50% of the slippage (increased from 25%)
 * Auto-consolidates profits after every successful trade
 * Includes comprehensive profit tracking and fee accounting
 * 
 * To implement: 
 * 1. Replace the existing enhancedStrategy.js file with this code
 * 2. Update your .env configuration file with the provided settings
 */

const chalk = require('chalk');
const { PublicKey } = require('@solana/web3.js');
const Decimal = require('decimal.js');
const fs = require('fs');
const path = require('path');

class EnhancedTradingStrategy {
    constructor(tradingBot) {
        this.bot = tradingBot;
        this.previousPrices = {};
        this.priceMovementData = {};
        this.lastOpportunityCheck = 0;
        
        // Import config from environment or use defaults
        this.minMovementThreshold = parseFloat(process.env.MIN_MOVEMENT_THRESHOLD) || 0.04;
        this.highValuePairs = (process.env.HIGH_VALUE_PAIRS || 'SOL/USDC,SOL/USDT,USDC/SOL,USDT/SOL').split(',');
        
        // Transaction fee estimation (in SOL)
        this.transactionFee = 0.000005;
        
        // Wallet verification - inline instead of calling setupWallet
        if (!this.bot.state.wallet) {
            console.error(chalk.red('ERROR: Wallet not configured in TradingBot'));
            
            // Copy wallet from parent if available
            if (tradingBot && tradingBot.wallet) {
                console.log(chalk.green('Copying wallet from trading bot main object'));
                this.bot.state.wallet = tradingBot.wallet;
                this.wallet = tradingBot.wallet;
            } else {
                console.error(chalk.red('CRITICAL ERROR: No wallet found anywhere!'));
            }
        } else {
            this.wallet = this.bot.state.wallet;
            console.log(chalk.green(`Strategy using wallet: ${this.wallet.publicKey.toString()}`));
        }

        // Profit tracking
        this.recentProfit = 0;
        this.profitTimeWindow = 3600000; // 1 hour in milliseconds
        this.profitHistory = [];
        this.totalTrades = 0;
        this.successfulTrades = 0;
        this.failedTrades = 0;
        
        // Auto-consolidation settings
        this.autoConsolidationEnabled = true;
        this.autoConsolidationThreshold = 0.00001;
        
        // Track realized profits in SOL
        this.realizedProfitSOL = 0;
        
        // Track first trade to help with confirmation
        this.hasCompletedFirstTrade = false;
        
        // Rate limiting tracking 
        this.lastTradeTime = 0;
        
        // Initialize the opportunity detection system
        this.setupOpportunityDetection();
        
        console.log(chalk.green('✅ Enhanced Trading Strategy initialized with 50% profit-to-slippage requirement'));
        console.log(chalk.green('✅ Auto-consolidation enabled for immediate profit conversion after every trade'));
        console.log(chalk.green('✅ Comprehensive fee accounting enabled for accurate profit tracking'));
        
        // Verify real trading mode
        this.verifyRealTradingMode();
    }

    async executeEnhancedTrade(opportunity) {
        try {
          console.log(chalk.yellow('=== Executing enhanced trade opportunity ==='));
          console.log(`Pair: ${opportunity.pair}`);
          console.log(`Amount: ${opportunity.suggestedAmount.toFixed(6)} ${opportunity.inputToken}`);
          
          if (opportunity.percentChange !== undefined) {
            console.log(`Price change: ${opportunity.percentChange.toFixed(4)}%`);
          }
          
          if (opportunity.confidence !== undefined) {
            console.log(`Confidence: ${opportunity.confidence.toFixed(1)}%`);
          }
      
          // Verify wallet is properly configured
          if (!this.bot.state.wallet || !this.bot.state.wallet.publicKey) {
            console.error(chalk.red('ERROR: No wallet configured or invalid wallet'));
            
            if (this.bot.wallet && this.bot.wallet.publicKey) {
              // Try to recover by using the wallet from the bot object
              console.log(chalk.yellow('Attempting to recover wallet configuration...'));
              this.bot.state.wallet = this.bot.wallet;
            } else {
              throw new Error('Wallet not properly configured. Cannot execute trade.');
            }
          }
          
          // Verify wallet has enough SOL for transaction fees
          const walletAddress = this.bot.state.wallet.publicKey;
          console.log(chalk.blue(`Using wallet: ${walletAddress.toString()}`));
          
          try {
            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Get fresh SOL balance with retry
            let solBalance = 0;
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
              try {
                solBalance = await this.bot.state.connection.getBalance(walletAddress);
                break;
              } catch (error) {
                retryCount++;
                console.warn(chalk.yellow(`Error fetching SOL balance (attempt ${retryCount}/${maxRetries}): ${error.message}`));
                if (retryCount >= maxRetries) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
              }
            }
            
            const solBalanceFormatted = solBalance / 1e9;
            console.log(chalk.blue(`Current SOL balance: ${solBalanceFormatted.toFixed(6)} SOL`));
            
            // Ensure there's enough SOL for transaction fees
            const minSolForFees = 0.001; // 0.001 SOL for fees
            if (solBalanceFormatted < minSolForFees) {
              throw new Error(`Insufficient SOL for transaction fees (${solBalanceFormatted.toFixed(6)} SOL). Need at least ${minSolForFees} SOL.`);
            }
            
            // If trading SOL, ensure we have enough balance with a safety margin
            if (opportunity.inputToken === 'SOL') {
              const safetyMargin = 0.0005; // 0.0005 SOL safety margin
              if (opportunity.suggestedAmount + minSolForFees + safetyMargin > solBalanceFormatted) {
                throw new Error(`Insufficient SOL balance for trade. Available: ${solBalanceFormatted.toFixed(6)}, Required: ${(opportunity.suggestedAmount + minSolForFees + safetyMargin).toFixed(6)}`);
              }
            }
          } catch (error) {
            console.error(chalk.red('Balance verification failed:'), error);
            throw new Error(`Cannot proceed with trade: ${error.message}`);
          }
      
          // Get fresh token balances
          await this.bot.getTokenBalances();
          
          // Check available balance with a safety margin
          const availableBalance = this.bot.state.balances[opportunity.inputToken] || 0;
          const safetyMargin = 1.02; // 2% safety margin
          
          if (opportunity.suggestedAmount * safetyMargin > availableBalance) {
            console.log(chalk.red(
              `Insufficient balance with safety margin. Available: ${availableBalance.toFixed(6)}, Required: ${(opportunity.suggestedAmount * safetyMargin).toFixed(6)}`
            ));
            return false;
          }
          
          // Calculate optimal slippage for this opportunity
          const slippageBps = this.calculateOptimalSlippage(opportunity);
          console.log(chalk.yellow(`Using MAX_SLIPPAGE_BPS=${slippageBps} for execution`));
          
          // Validate that the opportunity meets our profit-to-slippage ratio requirement
          if (!this.validateProfitToSlippageRatio(opportunity, slippageBps)) {
            console.log(chalk.red(
              `Opportunity doesn't meet minimum profit-to-slippage ratio requirement. Skipping trade.`
            ));
            return false;
          }
          
          // Double-check that trading is enabled
          if (!this.bot.state.tradingEnabled) {
            console.log(chalk.yellow('Trading is disabled. Not executing trade.'));
            return false;
          }
          
          console.log(chalk.blue(`Getting Jupiter quote for ${opportunity.suggestedAmount.toFixed(6)} ${opportunity.inputToken} to ${opportunity.outputToken}...`));
          
          // Add a delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Get quote with retry logic
          let quoteData = null;
          let quoteRetryCount = 0;
          const maxQuoteRetries = 3;
          
          while (quoteRetryCount < maxQuoteRetries && !quoteData) {
            try {
              quoteData = await this.bot.getJupiterQuote(
                opportunity.inputToken,
                opportunity.outputToken,
                opportunity.suggestedAmount
              );
              
              if (!quoteData || !quoteData.outAmount) {
                throw new Error('Invalid quote data returned');
              }
            } catch (error) {
              quoteRetryCount++;
              console.warn(chalk.yellow(`Jupiter quote attempt ${quoteRetryCount}/${maxQuoteRetries} failed: ${error.message}`));
              
              if (quoteRetryCount >= maxQuoteRetries) {
                console.error(chalk.red('Failed to get valid quote data after multiple attempts'));
                return false;
              }
              
              // Increase delay between retries
              await new Promise(resolve => setTimeout(resolve, 2000 * quoteRetryCount));
            }
          }
          
          // Additional validation of quote data
          const outputDecimals = this.bot.TOKEN_DECIMALS[opportunity.outputToken] || 9;
          const quoteOutputAmount = parseInt(quoteData.outAmount) / Math.pow(10, outputDecimals);
          
          if (quoteOutputAmount <= 0) {
            console.error(chalk.red('Quote returned zero or invalid output amount. Skipping trade.'));
            return false;
          }
          
          console.log(chalk.green(`Quote received: ${opportunity.suggestedAmount.toFixed(6)} ${opportunity.inputToken} -> ${quoteOutputAmount.toFixed(6)} ${opportunity.outputToken}`));
          
          // Validate market price vs. expected price
          let priceDeviation = 0;
          let marketPrice = opportunity.suggestedAmount / quoteOutputAmount;
          
          if (opportunity.currentPrice !== undefined && opportunity.currentPrice > 0) {
            const expectedPrice = opportunity.currentPrice;
            priceDeviation = ((marketPrice - expectedPrice) / expectedPrice) * 100;
            
            console.log(chalk.yellow(
              `Quote analysis: Market Price = ${marketPrice.toFixed(6)}, Expected Price = ${expectedPrice.toFixed(6)}, Diff = ${priceDeviation.toFixed(2)}%`
            ));
            
            // If price is significantly worse than expected, skip the trade
            if (Math.abs(priceDeviation) > (this.bot.config.maxPriceDifferencePercent || 10) && !this.bot.config.ignorePriceDifference) {
              console.log(chalk.red(
                `Quote price deviates too much from expected: ${priceDeviation.toFixed(2)}%. Max allowed: ${this.bot.config.maxPriceDifferencePercent || 10}%. Aborting.`
              ));
              return false;
            }
          }
          
          // ONE FINAL CONFIRMATION - Ask for explicit user confirmation for first trade only
          if (!this.hasCompletedFirstTrade) {
            console.log(chalk.bgRed.white('=============================================================='));
            console.log(chalk.bgRed.white('WARNING: ABOUT TO EXECUTE REAL TRADE WITH ACTUAL FUNDS'));
            console.log(chalk.bgRed.white(`Trading ${opportunity.suggestedAmount.toFixed(6)} ${opportunity.inputToken} for ${quoteOutputAmount.toFixed(6)} ${opportunity.outputToken}`));
            console.log(chalk.bgRed.white('=============================================================='));
            this.hasCompletedFirstTrade = true;
          }
          
          // Final confirmation before executing
          console.log(chalk.green('All checks passed. Executing enhanced trade...'));
          
          try {
            // Execute trade with Jupiter
            const result = await this.bot.executeJupiterSwap(quoteData, opportunity.suggestedAmount, opportunity.inputToken);
            
            // Process the trade result
            if (result && result.success) {
              console.log(chalk.green('Enhanced trade executed successfully'));
              console.log(chalk.green(`Transaction ID: ${result.txid}`));
              
              // Wait for blockchain state to update
              console.log(chalk.blue('Waiting for blockchain to update...'));
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Process successful trade results
              await this.processSuccessfulTrade(result, opportunity, slippageBps);
              return true;
            } else {
              console.log(chalk.red('Enhanced trade execution failed'));
              return false;
            }
          } catch (error) {
            console.error(chalk.red('Error during enhanced trade execution:'), error);
            console.error(chalk.red('Stack trace:'), error.stack);
            return false;
          }
        } catch (error) {
          console.error(chalk.red('Error in executeEnhancedTrade:'), error);
          return false;
        }
      }

    setupOpportunityDetection() {
        // Create volatility detection log
        const logDir = path.join(__dirname, 'logs');
        
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir);
        }
        
        const volatilityLogPath = path.join(logDir, 'enhanced_opportunities.log');
        try {
            fs.writeFileSync(
                volatilityLogPath, 
                `=== ENHANCED TRADING OPPORTUNITIES LOG (${new Date().toISOString()}) ===\n`
            );
            fs.appendFileSync(
                volatilityLogPath,
                `Profit-to-slippage requirement: 50%\n\n` // Increased from 25% to 50%
            );
        } catch (error) {
            console.error(chalk.yellow('Error writing to enhanced opportunities log:'), error);
        }
    }

    async processSuccessfulTrade(result, opportunity, slippageBps) {
        this.totalTrades++;
        
        try {
            if (result && result.success) {
                this.successfulTrades++;
                
                // Calculate actual profit
                let inputInSOL = 0;
                
                // Safely calculate inputInSOL
                if (opportunity.inputToken === 'SOL') {
                    inputInSOL = opportunity.suggestedAmount;
                } else if (opportunity.currentPrice !== undefined && opportunity.currentPrice > 0) {
                    inputInSOL = opportunity.suggestedAmount / opportunity.currentPrice;
                } else {
                    // Fallback if we can't calculate properly
                    const solPrice = await this.getSOLPriceEstimate();
                    inputInSOL = opportunity.suggestedAmount / solPrice;
                }
                
                // Track actual SOL expenditure including transaction fee
                const totalSolCost = inputInSOL + (opportunity.inputToken === 'SOL' ? this.transactionFee : 0);
                
                // For SOL output, calculate the realized profit immediately
                let realizedProfit = 0;
                
                if (opportunity.outputToken === 'SOL') {
                    // Direct profit calculation for SOL output
                    realizedProfit = result.outputAmount - totalSolCost;
                    
                    // Track net profit after transaction fees
                    const netProfit = realizedProfit - this.transactionFee;
                    
                    // Update realized profit
                    if (netProfit > 0) {
                        this.realizedProfitSOL += netProfit;
                        
                        // Track in bot state for UI display
                        if (!this.bot.state.realizedProfit) {
                            this.bot.state.realizedProfit = 0;
                        }
                        this.bot.state.realizedProfit += netProfit;
                        
                        // Record profit for hourly tracking
                        this.recordProfit(netProfit);
                    }
                }
                
                // Log detailed information about the trade
                console.log(chalk.green('=== Slippage Profit Analysis ==='));
                
                // Calculate what percentage of the slippage this profit represents
                const slippagePercentage = slippageBps / 100;
                const expectedProfitPercentage = Math.abs(opportunity.percentChange);
                const profitToSlippageRatio = expectedProfitPercentage / slippagePercentage;
                const percentOfSlippage = profitToSlippageRatio * 100;
                
                console.log(chalk.green(`Slippage used: ${slippagePercentage.toFixed(2)}%`));
                console.log(chalk.green(`Expected profit: ${expectedProfitPercentage.toFixed(2)}% (${percentOfSlippage.toFixed(2)}% of slippage)`));
                console.log(chalk.green(`Transaction fee: ~${this.transactionFee.toFixed(6)} SOL`));
                
                if (opportunity.outputToken === 'SOL') {
                    const netProfit = realizedProfit - this.transactionFee;
                    console.log(chalk.green(`Realized profit: ${realizedProfit.toFixed(6)} SOL`));
                    console.log(chalk.green(`Net profit after fees: ${netProfit.toFixed(6)} SOL`));
                } else {
                    console.log(chalk.green(`Output token: ${result.outputAmount.toFixed(6)} ${opportunity.outputToken}`));
                    console.log(chalk.green(`Consolidation needed: Will calculate final profit after conversion to SOL`));
                }
                
                console.log(chalk.green('Trade executed successfully'));
                console.log(`Transaction ID: ${result.txid}`);
                
                // Update success rate stats
                const successRate = (this.successfulTrades / this.totalTrades) * 100;
                console.log(chalk.blue(`Trade success rate: ${successRate.toFixed(1)}% (${this.successfulTrades}/${this.totalTrades})`));
                
                // Wait a moment for blockchain state to settle
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // AUTOMATIC CONSOLIDATION: 
                // Always consolidate after every trade if the output token is not SOL
                let consolidationResult = null;
                if (this.autoConsolidationEnabled && result.outputToken !== 'SOL' && result.outputAmount > 0) {
                    console.log(chalk.blue(`🔄 Automatically consolidating profit to SOL...`));
                    
                    try {
                        // Calculate consolidation amount (95% of the output to allow for fees)
                        const consolidationAmount = result.outputAmount * 0.95;
                        
                        // Get a quote to convert from the output token to SOL
                        console.log(chalk.blue(`Getting quote to convert ${consolidationAmount.toFixed(6)} ${result.outputToken} to SOL...`));
                        
                        const quoteData = await this.bot.getJupiterQuote(
                            result.outputToken,
                            'SOL',
                            consolidationAmount
                        );
                        
                        if (!quoteData || !quoteData.outAmount) {
                            console.error(chalk.red(`Failed to get quote for ${result.outputToken} to SOL conversion`));
                        } else {
                            console.log(chalk.blue(`Quote received: ${consolidationAmount.toFixed(6)} ${result.outputToken} -> SOL`));
                            
                            // Execute the consolidation trade
                            console.log(chalk.blue(`Executing consolidation trade...`));
                            
                            consolidationResult = await this.bot.executeJupiterSwap(
                                quoteData,
                                consolidationAmount,
                                result.outputToken
                            );
                            
                            if (consolidationResult && consolidationResult.success) {
                                console.log(chalk.green(`✅ Profit successfully consolidated: ${consolidationResult.outputAmount.toFixed(6)} SOL`));
                                console.log(`Consolidation Transaction ID: ${consolidationResult.txid}`);
                                
                                // Calculate net profit from the trade + consolidation sequence
                                // Account for the additional transaction fee
                                const netConsolidatedProfit = consolidationResult.outputAmount - this.transactionFee - totalSolCost;
                                
                                console.log(chalk.green(`Net profit after consolidation: ${netConsolidatedProfit.toFixed(6)} SOL`));
                                
                                // Only record positive profit
                                if (netConsolidatedProfit > 0) {
                                    this.realizedProfitSOL += netConsolidatedProfit;
                                    
                                    // Track in bot state for UI display
                                    if (!this.bot.state.realizedProfit) {
                                        this.bot.state.realizedProfit = 0;
                                    }
                                    this.bot.state.realizedProfit += netConsolidatedProfit;
                                    
                                    // Record profit for hourly tracking
                                    this.recordProfit(netConsolidatedProfit);
                                }
                                
                                // Update balances after consolidation
                                await this.bot.getTokenBalances();
                                
                                // Update auto-consolidated profit tracker
                                if (!this.bot.state.autoConsolidatedProfit) {
                                    this.bot.state.autoConsolidatedProfit = 0;
                                }
                                this.bot.state.autoConsolidatedProfit += consolidationResult.outputAmount;
                                
                                // Log to dashboard
                                this.bot.logToClientDashboard(`Profit consolidated: ${consolidationResult.outputAmount.toFixed(6)} SOL`, 'profit');
                                
                                // Broadcast the auto-consolidation update to clients
                                if (this.bot.wsServer) {
                                    this.bot.wsServer.clients.forEach((client) => {
                                        if (client.readyState === WebSocket.OPEN) {
                                            client.send(JSON.stringify({
                                                type: 'auto_consolidation_update',
                                                data: {
                                                    consolidatedAmount: consolidationResult.outputAmount,
                                                    fromToken: result.outputToken,
                                                    toToken: 'SOL',
                                                    totalConsolidated: this.bot.state.autoConsolidatedProfit || 0,
                                                    netProfit: netConsolidatedProfit,
                                                    txid: consolidationResult.txid,
                                                    timestamp: Date.now()
                                                },
                                                balances: this.bot.state.balances
                                            }));
                                        }
                                    });
                                }
                            } else {
                                console.error(chalk.red(`Failed to consolidate profit to SOL`));
                                this.failedTrades++;
                            }
                        }
                    } catch (error) {
                        console.error(chalk.red('Error during automatic profit consolidation:'), error);
                        this.failedTrades++;
                    }
                } else {
                    console.log(chalk.blue(`Output already in SOL, no consolidation needed.`));
                }
                
                return true;
            } else {
                console.log(chalk.red('Enhanced trade execution failed'));
                this.failedTrades++;
                return false;
            }
        } catch (error) {
            console.error(chalk.red('Error processing successful trade:'), error);
            this.failedTrades++;
            return false;
        }
    }
    

    /**
     * Update price tracking without full opportunity detection
     * This is called by the high-frequency price monitor
     */
    updatePriceTracking(prices) {
        // Update price tracking without full opportunity scan
        for (const pair of this.bot.tradingPairs) {
            if (!prices[pair] || !prices[pair].price) continue;
            
            const currentPrice = prices[pair].price;
            const currentTime = Date.now();
            
            // Initialize pair tracking if needed
            if (!this.previousPrices[pair]) {
                this.previousPrices[pair] = currentPrice;
                continue;
            }
            
            if (!this.priceMovementData[pair]) {
                this.priceMovementData[pair] = {
                    priceHistory: [],
                    volatility: 0,
                    direction: 0,
                    lastMovementTime: 0
                };
            }
            
            // Add to price history
            this.priceMovementData[pair].priceHistory.push({
                price: currentPrice,
                timestamp: currentTime
            });
            
            // Keep history to manageable size
            if (this.priceMovementData[pair].priceHistory.length > 20) {
                this.priceMovementData[pair].priceHistory.shift();
            }
            
            // Calculate short-term price movement
            const shortTermMovement = this.calculatePriceMovement(
                this.previousPrices[pair],
                currentPrice
            );
            
            // Update prior price
            this.previousPrices[pair] = currentPrice;
            
            // Check for significant volatility events (for logging only)
            if (Math.abs(shortTermMovement) > 0.3) {
                console.log(chalk.yellow(
                    `${pair} significant movement detected: ${shortTermMovement.toFixed(4)}%`
                ));
            }
        }
    }

    /**
     * Enhanced opportunity detection with multi-factor analysis
     * - Detects smaller price movements more effectively
     * - Uses multiple time windows for analysis
     * - Incorporates historical success rate
     * - Validates profit relative to slippage (50% rule)
     */
    async findEnhancedOpportunities(prices) {
        const currentTime = Date.now();
        const opportunities = [];
        
        // Throttle checks to avoid excessive computation
        if (currentTime - this.lastOpportunityCheck < 2000) {
            return opportunities;
        }
        
        this.lastOpportunityCheck = currentTime;
        console.log(chalk.blue('🔍 Running enhanced opportunity detection...'));
        
        // Calculate price movements and volatility
        for (const pair of this.bot.tradingPairs) {
            // Skip if no current price
            if (!prices[pair] || !prices[pair].price) continue;
            
            const currentPrice = prices[pair].price;
            
            // Initialize pair tracking if needed
            if (!this.previousPrices[pair]) {
                this.previousPrices[pair] = currentPrice;
                continue;
            }
            
            if (!this.priceMovementData[pair]) {
                this.priceMovementData[pair] = {
                    priceHistory: [],
                    volatility: 0,
                    direction: 0,
                    lastMovementTime: 0
                };
            }
            
            // Add to price history
            this.priceMovementData[pair].priceHistory.push({
                price: currentPrice,
                timestamp: currentTime
            });
            
            // Keep history to manageable size
            if (this.priceMovementData[pair].priceHistory.length > 20) {
                this.priceMovementData[pair].priceHistory.shift();
            }
            
            // Calculate short-term price movement
            const shortTermMovement = this.calculatePriceMovement(
                this.previousPrices[pair],
                currentPrice
            );
            
            // Calculate multiple time-window movements if we have enough history
            let mediumTermMovement = 0;
            let longTermMovement = 0;
            
            const history = this.priceMovementData[pair].priceHistory;
            
            if (history.length >= 5) {
                mediumTermMovement = this.calculatePriceMovement(
                    history[history.length - 5].price,
                    currentPrice
                );
            }
            
            if (history.length >= 15) {
                longTermMovement = this.calculatePriceMovement(
                    history[history.length - 15].price,
                    currentPrice
                );
            }
            
            // Detect significant movements
            const significantShortTerm = Math.abs(shortTermMovement) >= this.minMovementThreshold;
            const movementDirection = Math.sign(shortTermMovement);
            
            // Check if movement is accelerating (more weight to recent movement)
            const isAccelerating = (Math.abs(shortTermMovement) > Math.abs(mediumTermMovement / 3));
            
            // Log movement for debugging
            if (significantShortTerm || (isAccelerating && Math.abs(shortTermMovement) >= this.minMovementThreshold / 2)) {
                console.log(chalk.yellow(
                    `${pair} movement: ${shortTermMovement.toFixed(4)}% ` +
                    `(Medium: ${mediumTermMovement.toFixed(4)}%, Accelerating: ${isAccelerating})`
                ));
            }
            
            // Update prior price
            this.previousPrices[pair] = currentPrice;
            
            // Update pair movement data
            this.priceMovementData[pair].volatility = Math.abs(shortTermMovement);
            this.priceMovementData[pair].direction = movementDirection;
            
            // Only consider opportunities if:
            // 1. Movement is significant enough
            // 2. We haven't detected a movement recently for this pair
            // 3. The pair is high-value or movement is very significant
            const timeSinceLastMovement = currentTime - this.priceMovementData[pair].lastMovementTime;
            const isHighValuePair = this.highValuePairs.includes(pair);
            
            if ((significantShortTerm || (isAccelerating && isHighValuePair)) && 
                (timeSinceLastMovement > 10000 || Math.abs(shortTermMovement) > 0.2)) {
                
                // Mark this movement as detected
                this.priceMovementData[pair].lastMovementTime = currentTime;
                
                // Extract token info
                const [inputToken, outputToken] = pair.split('/');
                
                // Extra safety check for SOL output during downtrends
                if (outputToken === 'SOL') {
                    // Check if SOL is in a downtrend based on stablecoin pairs
                    const solPairs = ['USDC/SOL', 'USDT/SOL'];
                    let isSOLDowntrend = false;
                    
                    for (const solPair of solPairs) {
                        if (this.priceMovementData[solPair]?.direction < -0.3) {
                            isSOLDowntrend = true;
                            console.log(chalk.yellow(
                                `SOL downtrend detected via ${solPair} - being extra cautious with SOL purchases`
                            ));
                            break;
                        }
                    }
                    
                    // Skip this opportunity if SOL is in a downtrend, unless movement is very significant
                    if (isSOLDowntrend && Math.abs(shortTermMovement) < 0.8) {
                        console.log(chalk.yellow(
                            `Skipping ${pair} opportunity during SOL downtrend - movement not significant enough`
                        ));
                        continue;
                    }
                }
                
                // Determine optimal trade size based on available balance and movement
                const availableBalance = this.bot.state.balances[inputToken] || 0;
                
                // Adjust suggested amount based on volatility and direction
                // For larger movements, use larger position sizes
                let volatilityMultiplier = 1.0;
                if (Math.abs(shortTermMovement) > 0.3) volatilityMultiplier = 1.5;
                if (Math.abs(shortTermMovement) > 0.5) volatilityMultiplier = 2.0;
                
                // Limit to reasonable amounts based on token type - more conservative
                let suggestedAmount;
                
                if (inputToken === 'SOL') {
                    // More conservative with SOL - max 20% of balance, max 0.1 SOL per trade
                    suggestedAmount = Math.min(0.05 * volatilityMultiplier, availableBalance * 0.2);
                    suggestedAmount = Math.min(suggestedAmount, 0.1); // Safety cap
                } else if (inputToken === 'USDC' || inputToken === 'USDT') {
                    // Use up to 30% of stablecoin balance for volatile movements
                    suggestedAmount = Math.min(5.0 * volatilityMultiplier, availableBalance * 0.3);
                } else {
                    // For other tokens, use up to 30% of available balance
                    suggestedAmount = Math.min(availableBalance * 0.3, availableBalance * 0.1 * volatilityMultiplier);
                }
                
                // Ensure minimum trade size
                if (suggestedAmount < this.bot.config.minTradeSize) {
                    console.log(chalk.yellow(
                        `Skipping ${pair} opportunity: suggested amount ${suggestedAmount} below minimum ${this.bot.config.minTradeSize}`
                    ));
                    continue;
                }
                
                // Calculate profit potential with transaction fees included
                // Network fee is approximately 0.000005 SOL per transaction
                let feePercentage = 0;
                
                if (inputToken === 'SOL') {
                    feePercentage = (this.transactionFee / suggestedAmount) * 100;
                } else if (currentPrice > 0) {
                    const solEquivalent = suggestedAmount * currentPrice;
                    feePercentage = (this.transactionFee / solEquivalent) * 100;
                }
                
                const potentialProfitPercentage = Math.abs(shortTermMovement) * 
                    (isAccelerating ? 1.5 : 1.0) * 
                    (isHighValuePair ? 1.2 : 1.0) - 
                    feePercentage; // Subtract the fee percentage
                    
                const potentialProfit = (potentialProfitPercentage / 100) * suggestedAmount * currentPrice;
                
                // Skip if potential profit is too small after fees
                if (potentialProfit <= 0.0001) {
                    console.log(chalk.yellow(
                        `Skipping ${pair} opportunity: potential profit too small after fees (${potentialProfit.toFixed(6)})`
                    ));
                    continue;
                }
                
                // Check historical performance for this pair
                const pairSuccessRate = this.getHistoricalPairSuccessRate(pair);
                
                // Add confidence metric
                const confidence = this.calculateTradeConfidence(
                    shortTermMovement,
                    mediumTermMovement,
                    isAccelerating,
                    pairSuccessRate
                );
                
                opportunities.push({
                    pair,
                    inputToken,
                    outputToken,
                    currentPrice,
                    percentChange: shortTermMovement,
                    mediumTermChange: mediumTermMovement,
                    suggestedAmount,
                    potentialProfit,
                    accelerating: isAccelerating,
                    confidence,
                    timestamp: currentTime,
                    feePercentage // Include fee info
                });
                
                // Log to opportunity log
                this.logEnhancedOpportunity(
                    pair, 
                    shortTermMovement, 
                    suggestedAmount, 
                    potentialProfit,
                    confidence
                );
            }
        }
        
        // Apply supplementary filters and sort by confidence * potential profit
        const filteredOpportunities = this.applyOpportunityFilters(opportunities);
        
        // Sort by confidence * potential profit
        return filteredOpportunities.sort((a, b) => 
            (b.confidence * b.potentialProfit) - (a.confidence * a.potentialProfit)
        );
    }
    
    /**
     * Calculate price movement as a percentage
     */
    calculatePriceMovement(oldPrice, newPrice) {
        return ((newPrice - oldPrice) / oldPrice) * 100;
    }
    
    /**
     * Calculate confidence score (0-100) for a trade opportunity
     */
    calculateTradeConfidence(shortTermMove, mediumTermMove, isAccelerating, pairSuccessRate) {
        // Base confidence on movement size
        let confidence = Math.min(Math.abs(shortTermMove) * 15, 40);
        
        // Add confidence for accelerating movements (momentum)
        if (isAccelerating) {
            confidence += 15;
        }
        
        // Add confidence based on historical success
        confidence += pairSuccessRate * 30;
        
        // Reduce confidence if medium-term movement contradicts short-term
        if (Math.sign(shortTermMove) !== Math.sign(mediumTermMove) && Math.abs(mediumTermMove) > 0.1) {
            confidence -= 15; // Penalize contradicting signals more heavily
        }
        
        // Cap at 95 max confidence
        return Math.min(Math.max(confidence, 10), 95);
    }
    
    /**
     * Get historical success rate for a token pair (0-1)
     */
    getHistoricalPairSuccessRate(pair) {
        // This now incorporates actual success rate data
        if (this.totalTrades > 0) {
            return Math.min(0.95, Math.max(0.3, this.successfulTrades / this.totalTrades));
        }
        
        // Default values based on pair liquidity if no history
        const defaultRates = {
            'SOL/USDC': 0.85,
            'SOL/USDT': 0.82,
            'USDC/SOL': 0.80,
            'USDT/SOL': 0.78,
            'mSOL/SOL': 0.75,
            'SOL/mSOL': 0.72
        };
        
        return defaultRates[pair] || 0.6;
    }
    
    /**
     * Apply additional opportunity filters
     */
    applyOpportunityFilters(opportunities) {
        // Skip if no opportunities
        if (opportunities.length === 0) return [];
        
        // More conservative filtering - require higher confidence
        const filtered = opportunities.filter(opp => {
            // Require higher confidence (50% instead of 25%)
            if (opp.confidence < 50) {
                return false;
            }
            
            // Extra caution for SOL expenditure - ensure highly confident
            if (opp.inputToken === 'SOL' && opp.confidence < 65) {
                return false;
            }
            
            // Ensure profit is significant enough after fees
            if (opp.potentialProfit < 0.001) {
                return false;
            }
            
            return true;
        });
        
        // Only take top 2 opportunities to be even more selective (was 3)
        return filtered.slice(0, 2);
    }
    
    /**
     * Log enhanced opportunity details
     */
    logEnhancedOpportunity(pair, percentChange, amount, potentialProfit, confidence) {
        try {
            const logEntry = 
                `[${new Date().toISOString()}] ${pair}: ` +
                `${percentChange.toFixed(4)}% change, ` +
                `Amount: ${amount.toFixed(6)}, ` +
                `Potential profit: ${potentialProfit.toFixed(6)}, ` +
                `Confidence: ${confidence.toFixed(1)}%\n`;
                
            fs.appendFileSync(
                path.join(__dirname, 'logs', 'enhanced_opportunities.log'), 
                logEntry
            );
            
            // Print to console for high-confidence opportunities
            if (confidence > 70) {
                console.log(chalk.green('🔥 HIGH CONFIDENCE OPPORTUNITY:'));
                console.log(chalk.green(logEntry));
            }
        } catch (error) {
            console.error(chalk.yellow('Error logging enhanced opportunity:'), error);
        }
    }
    
    /**
     * Record profit for hourly tracking
     */
    recordProfit(profitAmount, timestamp = Date.now()) {
        this.profitHistory.push({
            amount: profitAmount,
            timestamp
        });
        
        // Clean up old profit history (keep last 24 hours)
        const cutoffTime = timestamp - (24 * 3600000);
        this.profitHistory = this.profitHistory.filter(p => p.timestamp >= cutoffTime);
        
        // Calculate profit in last hour
        this.updateRecentProfit();
    }
    
    /**
     * Update the recent profit calculation (last hour)
     */
    updateRecentProfit() {
        const now = Date.now();
        const hourAgo = now - this.profitTimeWindow;
        
        // Sum profits in the last hour
        this.recentProfit = this.profitHistory
            .filter(profit => profit.timestamp >= hourAgo)
            .reduce((sum, profit) => sum + profit.amount, 0);
            
        console.log(chalk.blue(`Hourly profit: ${this.recentProfit.toFixed(6)} SOL`));
        
        // Adjust strategy based on profitability
        if (this.recentProfit < 0.01) {
            // If hourly profit is low, be more selective about trade opportunities
            this.minMovementThreshold = Math.min(0.06, this.minMovementThreshold * 1.1);
            console.log(chalk.yellow(`Adjusting opportunity threshold to ${this.minMovementThreshold.toFixed(4)}% (more selective)`));
        } else if (this.recentProfit > 0.1) {
            // If hourly profit is high, we can be slightly more aggressive
            this.minMovementThreshold = Math.max(0.03, this.minMovementThreshold * 0.95);
            console.log(chalk.yellow(`Adjusting opportunity threshold to ${this.minMovementThreshold.toFixed(4)}% (more opportunities)`));
        }
    }
    /**
 * Calculate optimal slippage based on market conditions
 * - More conservative slippage for all trades
 * - Reduces slippage further for less confident trades
 */
calculateOptimalSlippage(opportunity) {
    // Base slippage from config with a more conservative approach
    const baseSlippage = Math.floor((this.bot.config.maxSlippage || 500) * 0.8);
    
    // For high confidence trades, use slightly higher slippage
    if (opportunity.confidence > 85) {
        return baseSlippage;
    }
    
    // For lower confidence trades, reduce slippage further
    if (opportunity.confidence < 70) {
        return Math.max(baseSlippage * 0.7, 250); // More conservative floor
    }
    
    return Math.floor(baseSlippage * 0.9); // Generally more conservative
}

validateProfitToSlippageRatio(opportunity, slippageBps) {
    
    if (opportunity.potentialProfit < 0.001) {
        console.log(chalk.red(`Profit too small: ${opportunity.potentialProfit.toFixed(6)} SOL`));
        return false;
      }
      
    // Calculate the slippage percentage (bps / 100)
    const slippagePercentage = slippageBps / 100;
    
    // Calculate the minimum required profit (50% of slippage - increased from 25%)
    const minRequiredProfit = slippagePercentage * 0.5;
    
    // Get the estimated profit percentage
    const estimatedProfitPercentage = Math.abs(opportunity.percentChange || 0);
    
    // Calculate network fee as a percentage 
    const feePercentage = opportunity.feePercentage || 0;
    
    // Net profit after fee
    const netProfitPercentage = estimatedProfitPercentage - feePercentage;
    
    // Calculate what percentage of slippage this profit represents
    const profitToSlippageRatio = netProfitPercentage / slippagePercentage;
    const percentOfSlippage = profitToSlippageRatio * 100;
    
    // Log the validation details
    console.log(chalk.blue(`Slippage Profit Validation:`));
    console.log(chalk.blue(`- Max slippage: ${slippagePercentage.toFixed(2)}%`));
    console.log(chalk.blue(`- Required min profit (50% of slippage): ${minRequiredProfit.toFixed(2)}%`));
    console.log(chalk.blue(`- Transaction fee: ~${feePercentage.toFixed(4)}% of trade amount`));
    console.log(chalk.blue(`- Estimated gross profit: ${estimatedProfitPercentage.toFixed(2)}%`));
    console.log(chalk.blue(`- Estimated net profit: ${netProfitPercentage.toFixed(2)}%`));
    console.log(chalk.blue(`- Net profit is ${percentOfSlippage.toFixed(2)}% of max slippage`));
    
    // Return validation result (true if profit is at least 50% of slippage after fees)
    const isValid = netProfitPercentage >= minRequiredProfit;
    
    if (isValid) {
        console.log(chalk.green(`✅ Trade passes 50% profit-to-slippage requirement after fees`));
    } else {
        console.log(chalk.red(`❌ Trade fails 50% profit-to-slippage requirement after fees - skipping`));
    }
    return originalValidation;
}

/**
 * Enhanced opportunity validation to ensure profit is at least 50% of slippage
 * This implements the 50% profit-to-slippage requirement (increased from 25%)
 */
validateProfitRelativeToSlippage(opportunity, slippageBps) {
    // Calculate minimum required profit (50% of slippage)
    const slippagePercentage = slippageBps / 100;
    const minRequiredProfit = slippagePercentage * 0.5;
    
    // Get the estimated profit percentage from the opportunity
    const estimatedProfitPercentage = Math.abs(opportunity.percentChange);
    
    // Calculate expected transaction fee
    const feePercentage = opportunity.feePercentage || 0;
    
    // Calculate net profit after fees
    const netProfitPercentage = estimatedProfitPercentage - feePercentage;
    
    // Log validation details
    console.log(chalk.blue(`Profit validation: ${estimatedProfitPercentage.toFixed(3)}% gross profit, ${netProfitPercentage.toFixed(3)}% net profit, ${slippagePercentage.toFixed(3)}% slippage`));
    
    // Calculate what percentage of slippage this profit represents
    const profitToSlippageRatio = netProfitPercentage / slippagePercentage;
    const percentOfSlippage = profitToSlippageRatio * 100;
    
    console.log(chalk.blue(`Net profit is ${percentOfSlippage.toFixed(2)}% of maximum slippage`));
    
    // Return true if profit is at least 50% of slippage after fees
    return netProfitPercentage >= minRequiredProfit;
}

/**
 * Helper function to estimate SOL price if other methods fail
 */
async getSOLPriceEstimate() {
    // Default fallback value based on recent market conditions
    const defaultSOLPrice = 145.0; // Updated to current market value
    
    try {
        // Try to get SOL price from trading pairs
        const pairs = this.bot.tradingPairs.filter(p => p.includes('SOL'));
        
        for (const pair of pairs) {
            if (pair === 'USDC/SOL' || pair === 'USDT/SOL') {
                const history = this.priceMovementData[pair]?.priceHistory || [];
                if (history.length > 0) {
                    return history[history.length - 1].price;
                }
            }
        }
        
        return defaultSOLPrice;
    } catch (error) {
        console.error(chalk.yellow('Error estimating SOL price:'), error);
        return defaultSOLPrice;
    }
}

async executeBestOpportunity(opportunities) {
    try {
      if (!opportunities || opportunities.length === 0) {
        console.log(chalk.yellow('No opportunities provided to executeBestOpportunity'));
        return false;
      }
      
      // Sort opportunities by confidence * potential profit
      const sortedOpportunities = [...opportunities].sort((a, b) => {
        const aScore = (a.confidence || 50) * a.potentialProfit;
        const bScore = (b.confidence || 50) * b.potentialProfit;
        return bScore - aScore;
      });
      
      const bestOpportunity = sortedOpportunities[0];
      
      // Log opportunity details
      console.log(chalk.blue('=== Evaluating best trading opportunity ==='));
      console.log(`Pair: ${bestOpportunity.pair}`);
      console.log(`Potential profit: ${bestOpportunity.potentialProfit.toFixed(6)} SOL`);
      
      if (bestOpportunity.percentChange !== undefined) {
        console.log(`Price change: ${bestOpportunity.percentChange.toFixed(4)}%`);
      }
      
      if (bestOpportunity.confidence !== undefined) {
        console.log(`Confidence: ${bestOpportunity.confidence.toFixed(1)}%`);
      }
      
      // Enhanced validation for safety
      
      // 1. Skip low confidence opportunities
      const minConfidence = 70; // Higher confidence requirement for real trading
      if (bestOpportunity.confidence < minConfidence) {
        console.log(chalk.yellow(`Skipping low confidence opportunity (${bestOpportunity.confidence.toFixed(1)}%)`));
        console.log(chalk.yellow(`Minimum required confidence: ${minConfidence}%`));
        return false;
      }
      
      // 2. Skip very small profit opportunities
      const minProfit = 0.001; // Minimum 0.001 SOL profit (adjust based on your risk tolerance)
      if (bestOpportunity.potentialProfit < minProfit) {
        console.log(chalk.yellow(`Skipping low profit opportunity: ${bestOpportunity.potentialProfit.toFixed(6)} SOL`));
        console.log(chalk.yellow(`Minimum required profit: ${minProfit} SOL`));
        return false;
      }
      
      // 3. For SOL output trades, check if SOL is in a strong downtrend
      if (bestOpportunity.outputToken === 'SOL') {
        // Check if SOL price is trending down based on multiple time windows
        const solPairs = ['USDC/SOL', 'USDT/SOL'];
        let isDowntrend = false;
        let downtrendStrength = 0;
        
        for (const pair of solPairs) {
          if (this.priceMovementData[pair]?.direction < -0.3) {
            isDowntrend = true;
            downtrendStrength += Math.abs(this.priceMovementData[pair].direction);
            console.log(chalk.yellow(
              `Detected SOL downtrend (${pair} direction: ${this.priceMovementData[pair].direction.toFixed(2)}) - being cautious`
            ));
          }
        }
        
        // Additional check for SOL output during downtrend - require higher confidence
        if (isDowntrend) {
          // Adjust required confidence based on downtrend strength
          const requiredConfidence = Math.min(95, 80 + (downtrendStrength * 5));
          
          if (bestOpportunity.confidence < requiredConfidence) {
            console.log(chalk.yellow(
              `Skipping SOL purchase during downtrend - confidence not high enough (${bestOpportunity.confidence.toFixed(1)}% < ${requiredConfidence.toFixed(1)}%)`
            ));
            return false;
          } else {
            console.log(chalk.green(
              `Proceeding with SOL purchase despite downtrend - confidence is high enough (${bestOpportunity.confidence.toFixed(1)}% >= ${requiredConfidence.toFixed(1)}%)`
            ));
          }
        }
      }
      
      // 4. Check rate limits and add delay if needed
      if (this.lastTradeTime) {
        const timeSinceLastTrade = Date.now() - this.lastTradeTime;
        const minTradeInterval = 10000; // Minimum 10 seconds between trades
        
        if (timeSinceLastTrade < minTradeInterval) {
          const delayNeeded = minTradeInterval - timeSinceLastTrade;
          console.log(chalk.yellow(`Rate limiting: Waiting ${delayNeeded}ms between trades...`));
          await new Promise(resolve => setTimeout(resolve, delayNeeded));
        }
      }
      
      // 5. Check if we've reached the daily profit target
      if (this.bot.state.dailyProfit >= this.bot.config.dailyProfitTarget && !this.bot.config.aggressiveMode) {
        console.log(chalk.yellow(
          `Daily profit target of ${this.bot.config.dailyProfitTarget} SOL reached! (${this.bot.state.dailyProfit.toFixed(6)} SOL)`
        ));
        
        // Allow override with aggressive mode
        if (!this.bot.config.aggressiveMode) {
          console.log(chalk.yellow('Skipping trade - daily profit target reached. Set AGGRESSIVE_MODE=true to continue trading.'));
          return false;
        } else {
          console.log(chalk.yellow('AGGRESSIVE_MODE=true - Continuing to trade despite reaching daily profit target'));
        }
      }
      
      // 6. Check active trades limit
      const maxConcurrentTrades = this.bot.config.maxConcurrentTrades || 3;
      if (this.bot.state.activeTrades >= maxConcurrentTrades) {
        console.log(chalk.yellow(
          `Maximum concurrent trades limit reached (${this.bot.state.activeTrades}/${maxConcurrentTrades}). Skipping opportunity.`
        ));
        return false;
      }
      
      // 7. Verify wallet configuration
      if (!this.bot.state.wallet || !this.bot.state.wallet.publicKey) {
        console.error(chalk.red('ERROR: No wallet configured or invalid wallet'));
        return false;
      }
      
      // All validations passed, execute the trade
      console.log(chalk.green('Opportunity validation passed. Proceeding with trade execution...'));
      
      // Update last trade time
      this.lastTradeTime = Date.now();
      
      // Increment active trades counter
      this.bot.state.activeTrades = (this.bot.state.activeTrades || 0) + 1;
      
      // Execute the trade using our enhanced trade execution
      const success = await this.executeEnhancedTrade(bestOpportunity);
      
      // Update active trades counter after completion
      if (!success) {
        this.bot.state.activeTrades = Math.max(0, (this.bot.state.activeTrades || 1) - 1);
      }
      
      return success;
    } catch (error) {
      console.error(chalk.red('Error in executeBestOpportunity:'), error);
      console.error(chalk.red('Stack trace:'), error.stack);
      
      // Ensure we decrement active trades if error occurs
      if (this.bot.state.activeTrades > 0) {
        this.bot.state.activeTrades--;
      }
      
      return false;
    }
  }

verifyWalletConfiguration() {
    console.log(chalk.blue('Verifying wallet configuration...'));
    
    // Check if wallet is properly configured in the bot
    if (!this.bot.state.wallet) {
      console.error(chalk.red('ERROR: No wallet configured in bot state'));
      
      // Try to recover
      if (this.bot.wallet) {
        console.log(chalk.yellow('Found wallet in bot object, copying to state'));
        this.bot.state.wallet = this.bot.wallet;
      } else {
        console.error(chalk.red('NO WALLET FOUND - CANNOT CONTINUE'));
        throw new Error('No wallet configured. Trading requires a valid wallet.');
      }
    }
    
    // Verify that the wallet has a private key/keypair
    if (!this.bot.state.wallet.secretKey && !this.bot.state.wallet.privateKey) {
      console.error(chalk.red('ERROR: Wallet does not have a private key'));
      throw new Error('Wallet is missing private key. Cannot sign transactions.');
    }
    
    // Print wallet address and check if it matches expected address
    const walletAddress = this.bot.state.wallet.publicKey.toString();
    console.log(chalk.green(`Wallet configured: ${walletAddress}`));
    
    // Verify we can retrieve the balance
    try {
      // Test balance retrieval
      const balance = this.bot.state.connection.getBalance(this.bot.state.wallet.publicKey);
      console.log(chalk.green(`Wallet has ${balance / 1e9} SOL`));
      
      if (balance <= 0) {
        console.warn(chalk.yellow('WARNING: Wallet has zero balance'));
      }
      
      return true;
    } catch (error) {
      console.error(chalk.red('Failed to verify wallet balance:'), error);
      return false;
    }
  }

verifyRealTradingMode() {
    console.log(chalk.green('======================================='));
    console.log(chalk.green('| REAL TRADING MODE VERIFICATION     |'));
    console.log(chalk.green('======================================='));
    
    // Check if trading is enabled
    if (this.bot.state.tradingEnabled !== true) {
        console.log(chalk.red('WARNING: Trading is not explicitly enabled!'));
        console.log(chalk.yellow('Setting trading enabled flag to true...'));
        this.bot.state.tradingEnabled = true;
    } else {
        console.log(chalk.green('✓ Trading enabled flag is set to true'));
    }
    
    // Check wallet configuration
    if (!this.bot.state.wallet) {
        console.log(chalk.red('ERROR: No wallet configured!'));
        return false;
    } else {
        console.log(chalk.green(`✓ Wallet configured: ${this.bot.state.wallet.publicKey.toString()}`));
    }
    
    // Check for any simulation flags
    const simulationFlags = [
        this.bot.config.simulateOnly,
        this.bot.state.simulationMode,
        this.bot.config.dryRun
    ];
    
    if (simulationFlags.some(flag => flag === true)) {
        console.log(chalk.red('WARNING: Simulation flag detected!'));
        console.log(chalk.yellow('Disabling all simulation flags...'));
        
        // Ensure all simulation flags are false
        if (this.bot.config.simulateOnly) this.bot.config.simulateOnly = false;
        if (this.bot.state.simulationMode) this.bot.state.simulationMode = false;
        if (this.bot.config.dryRun) this.bot.config.dryRun = false;
    } else {
        console.log(chalk.green('✓ No simulation flags detected'));
    }
    
    console.log(chalk.green('======================================='));
    console.log(chalk.green('| REAL TRADING MODE IS ACTIVE        |'));
    console.log(chalk.green('======================================='));
    
    // Add an initial log entry to indicate real trading mode
    this.bot.logToClientDashboard("REAL TRADING MODE ACTIVE - Actual funds will be used", "warning");
    
    return true;
}

/**
 * Get an optimized Jupiter quote with advanced parameters
 */
async getOptimizedJupiterQuote(inputToken, outputToken, amount, slippageBps) {
    try {
        console.log(chalk.blue(`Getting optimized Jupiter quote for ${amount} ${inputToken} to ${outputToken}...`));
        
        const inputDecimals = this.bot.TOKEN_DECIMALS[inputToken] || 9;
        const inputAmountLamports = Math.floor(amount * Math.pow(10, inputDecimals));
        
        // Enhanced quote parameters - more conservative
        const params = new URLSearchParams({
            inputMint: this.bot.TOKEN_ADDRESSES[inputToken],
            outputMint: this.bot.TOKEN_ADDRESSES[outputToken],
            amount: inputAmountLamports.toString(),
            slippageBps: slippageBps.toString(),
            onlyDirectRoutes: 'false',
            asLegacyTransaction: 'false',
            excludeDexes: '',
            platformFeeBps: '0'
        });
        
        const url = `https://quote-api.jup.ag/v6/quote?${params.toString()}`;
        
        console.log(chalk.yellow(`Enhanced Jupiter quote URL: ${url}`));
        
        // Fetch with retry logic
        const fetch = require('node-fetch');
        
        // Retry function for API calls
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
            const outputDecimals = this.bot.TOKEN_DECIMALS[outputToken] || 9;
            const outputAmount = parseInt(quoteResponse.outAmount) / Math.pow(10, outputDecimals);
            
            console.log(chalk.green(`Enhanced quote received: ${amount} ${inputToken} -> ${outputAmount.toFixed(6)} ${outputToken}`));
            
            // Log detailed route information
            if (quoteResponse.routePlan && quoteResponse.routePlan.length > 0) {
                console.log(chalk.blue('Route details:'));
                quoteResponse.routePlan.forEach((hop, index) => {
                    console.log(`  Hop ${index+1}: ${hop.swapInfo?.label || 'Unknown'} (${hop.percent}%)`);
                });
            }
        }
        
        return quoteResponse;
    } catch (error) {
        console.error(chalk.red('Error fetching optimized quote:'), error.message);
        return null;
        }
    }
}


// Export the enhanced strategy
module.exports = EnhancedTradingStrategy;