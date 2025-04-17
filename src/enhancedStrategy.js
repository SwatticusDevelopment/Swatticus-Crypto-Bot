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
        
        // Set the initial threshold from config or use default
        this.minMovementThreshold = parseFloat(process.env.MIN_MOVEMENT_THRESHOLD) || 0.05;
        
        // Store the original threshold to use during resets
        this.originalThreshold = this.minMovementThreshold;
        
        this.highValuePairs = ['SOL/USDC', 'SOL/USDT', 'USDC/SOL', 'USDT/SOL'];
        this.recentProfit = 0;
        this.profitTimeWindow = 3600000; // 1 hour in milliseconds
        this.profitHistory = [];
        
        // Last time the threshold was reset
        this.lastThresholdReset = Date.now();
        
        // Setup opportunity detection
        this.setupOpportunityDetection();
        
        // Setup threshold reset timer if enabled in config
        if (process.env.RESET_OPPORTUNITY_THRESHOLDS === 'true') {
            this.setupThresholdResets();
        }
    }

    setupThresholdResets() {
        const resetInterval = parseInt(process.env.THRESHOLD_RESET_INTERVAL) || 600000; // Default 10 minutes
        
        console.log(chalk.blue(`Setting up opportunity threshold resets every ${resetInterval/60000} minutes`));
        
        // Create interval to reset thresholds periodically
        setInterval(() => {
            // Reset the threshold to its original value
            this.minMovementThreshold = this.originalThreshold;
            
            // Log the reset
            console.log(chalk.yellow(`⚠️ Opportunity threshold reset to ${this.minMovementThreshold.toFixed(4)}%`));
            
            // Force a price update to look for new opportunities
            this.lastOpportunityCheck = 0;
            
            // Update last reset time
            this.lastThresholdReset = Date.now();
            
            // Log the reset to the opportunity log
            try {
                const logEntry = `[${new Date().toISOString()}] THRESHOLD RESET: Reverted to ${this.minMovementThreshold.toFixed(4)}%\n`;
                fs.appendFileSync(
                    path.join(__dirname, 'logs', 'enhanced_opportunities.log'), 
                    logEntry
                );
            } catch (error) {
                console.error(chalk.yellow('Error logging threshold reset:'), error);
            }
        }, resetInterval);
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
        } catch (error) {
            console.error(chalk.yellow('Error writing to enhanced opportunities log:'), error);
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
                
                // Determine optimal trade size based on available balance and movement
                const availableBalance = this.bot.state.balances[inputToken] || 0;
                
                // Adjust suggested amount based on volatility and direction
                // For larger movements, use larger position sizes
                let volatilityMultiplier = 1.0;
                if (Math.abs(shortTermMovement) > 0.3) volatilityMultiplier = 1.5;
                if (Math.abs(shortTermMovement) > 0.5) volatilityMultiplier = 2.0;
                
                // Limit to reasonable amounts based on token type
                let suggestedAmount;
                
                if (inputToken === 'SOL') {
                    // Use up to 30% of available SOL balance for volatile movements
                    suggestedAmount = Math.min(0.07 * volatilityMultiplier, availableBalance * 0.3);
                } else if (inputToken === 'USDC' || inputToken === 'USDT') {
                    // Use up to 40% of stablecoin balance for volatile movements
                    suggestedAmount = Math.min(5.0 * volatilityMultiplier, availableBalance * 0.4);
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
                
                // Calculate profit potential more accurately
                // For deeper movements, we can often realize more than the current differential
                const potentialProfitPercentage = Math.abs(shortTermMovement) * 
                    (isAccelerating ? 1.5 : 1.0) * 
                    (isHighValuePair ? 1.2 : 1.0);
                    
                const potentialProfit = (potentialProfitPercentage / 100) * suggestedAmount * currentPrice;
                
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
                    timestamp: currentTime
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
            confidence -= 10;
        }
        
        // Cap at 95 max confidence
        return Math.min(Math.max(confidence, 10), 95);
    }
    
    /**
     * Get historical success rate for a token pair (0-1)
     */
    getHistoricalPairSuccessRate(pair) {
        // This would normally analyze past trade success
        // For now using default values based on pair liquidity
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
        
        // Filter out opportunities with <25% confidence
        const filtered = opportunities.filter(opp => opp.confidence >= 25);
        
        // Only take top 3 opportunities to avoid diluting capital
        return filtered.slice(0, 3);
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
        
        // Check if we're meeting the hourly goal
        if (this.recentProfit < 0.1) { // Lowered target to be more realistic
            // Adjust strategy to be more aggressive, but not too aggressive
            const newThreshold = Math.max(0.03, this.minMovementThreshold * 0.9);
            console.log(chalk.yellow(`Adjusting opportunity threshold to ${newThreshold.toFixed(4)}%`));
            this.minMovementThreshold = newThreshold;
        } else {
            // We're meeting goals, can be slightly more conservative
            // But don't increase too much - maintain trading frequency
            const newThreshold = Math.min(this.originalThreshold, this.minMovementThreshold * 1.03);
            this.minMovementThreshold = newThreshold;
        }
        
        // If it's been over twice the reset interval since the last reset,
        // force a reset now (safeguard against threshold dropping too low)
        const resetInterval = parseInt(process.env.THRESHOLD_RESET_INTERVAL) || 600000;
        if (now - this.lastThresholdReset > resetInterval * 2) {
            console.log(chalk.red('⚠️ Emergency threshold reset - too long since last reset'));
            this.minMovementThreshold = this.originalThreshold;
            this.lastThresholdReset = now;
        }
    }
    
    /**
     * Calculate optimal slippage based on market conditions
     * - Uses more aggressive slippage for highly confident trades
     * - Reduces slippage for less confident trades
     */
    calculateOptimalSlippage(opportunity) {
        // Base slippage from config
        const baseSlippage = this.bot.config.maxSlippage || 500;
        
        // For high confidence trades, we can use higher slippage
        if (opportunity.confidence > 80) {
            return Math.min(baseSlippage * 1.2, 800);
        }
        
        // For low confidence trades, reduce slippage
        if (opportunity.confidence < 40) {
            return Math.max(baseSlippage * 0.8, 300);
        }
        
        return baseSlippage;
    }
    
            /**
 * Execute the best trade opportunity using advanced execution
 * This version includes defensive programming to avoid undefined errors
 */
async executeBestOpportunity(opportunities) {
    if (!opportunities || opportunities.length === 0) {
        return false;
    }
    
    const bestOpportunity = opportunities[0];
    console.log(chalk.yellow('=== Executing enhanced trade opportunity ==='));
    console.log(`Pair: ${bestOpportunity.pair}`);
    console.log(`Amount: ${bestOpportunity.suggestedAmount.toFixed(6)} ${bestOpportunity.inputToken}`);
    
    // Add null checks for these values to prevent "Cannot read properties of undefined"
    if (bestOpportunity.confidence !== undefined) {
        console.log(`Confidence: ${bestOpportunity.confidence.toFixed(1)}%`);
    }
    
    if (bestOpportunity.percentChange !== undefined) {
        console.log(`Price change: ${bestOpportunity.percentChange.toFixed(4)}%`);
    }
    
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
        
        if (result && result.success) {
            // Calculate actual profit
            let inputInSOL = 0;
            
            // Safely calculate inputInSOL
            if (bestOpportunity.inputToken === 'SOL') {
                inputInSOL = bestOpportunity.suggestedAmount;
            } else if (bestOpportunity.currentPrice !== undefined && bestOpportunity.currentPrice > 0) {
                inputInSOL = bestOpportunity.suggestedAmount / bestOpportunity.currentPrice;
            } else {
                // Fallback if we can't calculate properly
                const solPrice = await this.getSOLPriceEstimate();
                inputInSOL = bestOpportunity.suggestedAmount / solPrice;
            }
            
            const realizedProfit = result.outputAmount - inputInSOL;
            
            // Record profit for hourly tracking
            this.recordProfit(realizedProfit);
            
            console.log(chalk.green('Enhanced trade executed successfully'));
            console.log(`Transaction ID: ${result.txid}`);
            console.log(`Realized profit: ${realizedProfit.toFixed(6)} SOL`);
            
            // Update balances
            await this.bot.getTokenBalances();
            
            return true;
        } else {
            console.log(chalk.red('Enhanced trade execution failed'));
            return false;
        }
    } catch (error) {
        console.error(chalk.red('Error during enhanced trade execution:'), error);
        return false;
    }
}

/**
 * Helper function to estimate SOL price if other methods fail
 */
async getSOLPriceEstimate() {
    // Default fallback value based on recent market conditions
    const defaultSOLPrice = 133.0;
    
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
    
    /**
     * Get an optimized Jupiter quote with advanced parameters
     */
    async getOptimizedJupiterQuote(inputToken, outputToken, amount, slippageBps) {
        try {
            console.log(chalk.blue(`Getting optimized Jupiter quote for ${amount} ${inputToken} to ${outputToken}...`));
            
            const inputDecimals = this.bot.TOKEN_DECIMALS[inputToken] || 9;
            const inputAmountLamports = Math.floor(amount * Math.pow(10, inputDecimals));
            
            // Enhanced quote parameters
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