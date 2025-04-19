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
        
        // Initialize the opportunity detection system
        this.setupOpportunityDetection();
        
        console.log(chalk.green('✅ Enhanced Trading Strategy initialized with 50% profit-to-slippage requirement'));
        console.log(chalk.green('✅ Auto-consolidation enabled for immediate profit conversion after every trade'));
        console.log(chalk.green('✅ Comprehensive fee accounting enabled for accurate profit tracking'));
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
    
    return isValid;
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
    if (!opportunities || opportunities.length === 0) {
        return false;
    }
    
    const bestOpportunity = opportunities[0];
    
    // Don't trade if confidence is too low
    if (bestOpportunity.confidence < 60) {
        console.log(chalk.yellow(`Skipping low confidence opportunity (${bestOpportunity.confidence.toFixed(1)}%)`));
        return false;
    }
    
    // For SOL output trades, ensure SOL is not in a strong downtrend
    if (bestOpportunity.outputToken === 'SOL') {
        // Check if SOL price is trending down based on multiple time windows
        const solPairs = ['USDC/SOL', 'USDT/SOL'];
        let isDowntrend = false;
        
        for (const pair of solPairs) {
            if (this.priceMovementData[pair]?.direction < -0.3) {
                isDowntrend = true;
                console.log(chalk.yellow(
                    `Detected SOL downtrend (${pair} direction: ${this.priceMovementData[pair].direction.toFixed(2)}) - being cautious`
                ));
            }
        }
        
        // Additional check for SOL output during downtrend - require higher confidence
        if (isDowntrend && bestOpportunity.confidence < 85) {
            console.log(chalk.yellow(`Skipping SOL purchase during downtrend - confidence not high enough`));
            return false;
        }
    }
    
    console.log(chalk.yellow('=== Validating best trade opportunity ==='));
    console.log(`Pair: ${bestOpportunity.pair}`);
    console.log(`Amount: ${bestOpportunity.suggestedAmount.toFixed(6)} ${bestOpportunity.inputToken}`);
    
    // Add null checks for these values to prevent "Cannot read properties of undefined"
    if (bestOpportunity.confidence !== undefined) {
        console.log(`Confidence: ${bestOpportunity.confidence.toFixed(1)}%`);
    }
    
    if (bestOpportunity.percentChange !== undefined) {
        console.log(`Price change: ${bestOpportunity.percentChange.toFixed(4)}%`);
    }
    
    // Calculate optimal slippage for this opportunity
    const slippageBps = this.calculateOptimalSlippage(bestOpportunity);
    
    // Validate profit relative to slippage (50% rule)
    if (!this.validateProfitToSlippageRatio(bestOpportunity, slippageBps)) {
        console.log(chalk.red(
            `Opportunity doesn't meet minimum profit-to-slippage ratio requirement (50%). Skipping trade.`
        ));
        return false;
    }
    
    console.log(chalk.green(`Opportunity passes 50% profit-to-slippage validation. Proceeding with trade.`));
    
    try {
        // Get fresh balances before trading
        await this.bot.getTokenBalances();
        
        // Check available balance
        const availableBalance = this.bot.state.balances[bestOpportunity.inputToken] || 0;
        if (availableBalance < bestOpportunity.suggestedAmount) {
            console.log(chalk.red(
                `Insufficient balance. Available: ${availableBalance}, Required: ${bestOpportunity.suggestedAmount}`
            ));
            return false;
        }
        
        // Use bot's getJupiterQuote method instead of our own specialized one
        const quoteData = await this.bot.getJupiterQuote(
            bestOpportunity.inputToken,
            bestOpportunity.outputToken,
            bestOpportunity.suggestedAmount
        );
        
        if (!quoteData || !quoteData.outAmount) {
            console.error(chalk.red('Failed to get valid enhanced quote data'));
            return false;
        }
        
        // Additional validation of quote data
        const outputDecimals = this.bot.TOKEN_DECIMALS[bestOpportunity.outputToken] || 9;
        const quoteOutputAmount = parseInt(quoteData.outAmount) / Math.pow(10, outputDecimals);
        
        if (quoteOutputAmount <= 0) {
            console.error(chalk.red('Quote returned zero or invalid output amount. Skipping trade.'));
            return false;
        }
        
        // Add null checks before calculating values
        const marketPrice = bestOpportunity.suggestedAmount / quoteOutputAmount;
        
        // Add a safe check before using currentPrice
        let priceDeviation = 0;
        if (bestOpportunity.currentPrice !== undefined && bestOpportunity.currentPrice > 0) {
            const expectedPrice = bestOpportunity.currentPrice;
            priceDeviation = ((marketPrice - expectedPrice) / expectedPrice) * 100;
            
            // If price is significantly worse than expected, skip the trade
            if (priceDeviation > 2.0 && !this.bot.config.ignorePriceDifference) {
                console.log(chalk.red(
                    `Quote price unfavorable: ${priceDeviation.toFixed(2)}% worse than expected. Aborting.`
                ));
                return false;
            }
        }
        
        // Execute trade with our optimized quote
        console.log(chalk.green('All checks passed. Executing enhanced trade...'));
        const result = await this.bot.executeJupiterSwap(quoteData, bestOpportunity.suggestedAmount, bestOpportunity.inputToken);
        
        // Process the trade result with our new method that ensures wallet updates and automatic consolidation
        return await this.processSuccessfulTrade(result, bestOpportunity, slippageBps);
        
    } catch (error) {
        console.error(chalk.red('Error during enhanced trade execution:'), error);
        return false;
    }
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