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
    
    // IMPROVED WALLET VERIFICATION - MULTI-LEVEL CHECKS
    if (!this.bot.state || !this.bot.state.wallet) {
        console.error(chalk.red('ERROR: Wallet not configured in TradingBot'));
        
        // First try: Copy wallet from parent bot object
        if (tradingBot && tradingBot.wallet) {
            console.log(chalk.green('Copying wallet from trading bot main object'));
            
            // Initialize state if needed
            if (!this.bot.state) {
                this.bot.state = {};
            }
            
            this.bot.state.wallet = tradingBot.wallet;
            this.wallet = tradingBot.wallet;
            console.log(chalk.green(`Successfully retrieved wallet: ${this.wallet.publicKey.toString()}`));
        } 
        // Second try: Look for wallet in bot.state.keypair or other properties
        else if (tradingBot && tradingBot.state && tradingBot.state.keypair) {
            console.log(chalk.green('Found wallet keypair in trading bot state'));
            this.bot.state.wallet = tradingBot.state.keypair;
            this.wallet = tradingBot.state.keypair;
            console.log(chalk.green(`Retrieved wallet from keypair: ${this.wallet.publicKey.toString()}`));
        }
        // Third try: Check if server has passed wallet via serverState
        else if (tradingBot && tradingBot.serverState && tradingBot.serverState.wallet) {
            console.log(chalk.green('Found wallet in server state'));
            this.bot.state.wallet = tradingBot.serverState.wallet.keypair;
            this.wallet = tradingBot.serverState.wallet.keypair;
            console.log(chalk.green(`Retrieved wallet from server state: ${this.wallet.publicKey.toString()}`));
        }
        else {
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

      async executeJupiterSwapWithHighPriority(quoteData, amount, inputToken) {
        try {
          console.log(`Preparing high-priority swap: ${amount} ${inputToken}...`);
          
          // Use maximum compute units and higher priority fee
          const swapRequest = {
            userPublicKey: this.state.wallet.publicKey.toString(),
            wrapUnwrapSOL: true,
            useVersionedTransaction: true,
            quoteResponse: quoteData,
            computeUnitPriceMicroLamports: 25000, // Use higher priority fee (2.5x increase)
            maxComputeUnits: 1000000, // Maximum compute units
            dynamicComputeUnitLimit: true, // Allow adjustment
            prioritizationFeeLamports: 50000 // 0.00005 SOL priority fee (5x increase)
          };
          
          const response = await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(swapRequest)
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Jupiter API error (${response.status}): ${errorText}`);
            return false;
          }
          
          const swapResponse = await response.json();
          
          if (!swapResponse || !swapResponse.swapTransaction) {
            console.error(`Failed to get swap transaction: ${JSON.stringify(swapResponse)}`);
            return false;
          }
          
          console.log('Swap transaction prepared by Jupiter. Proceeding with signing and sending...');
          
          const transactionBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
          const transaction = VersionedTransaction.deserialize(transactionBuffer);
          
          console.log('Transaction deserialized successfully. Signing...');
          
          transaction.sign([this.state.wallet]);
          
          console.log('Transaction signed. Sending to Solana with high priority...');
          
          // Set up retry logic for sending transaction
          let txid = null;
          let retriesLeft = 5; // Increased retries
          
          while (retriesLeft > 0 && !txid) {
            try {
              txid = await this.state.connection.sendTransaction(transaction, {
                skipPreflight: false, // Enable preflight for better error checking
                maxRetries: 5,        // Increased retries
                preflightCommitment: 'confirmed'
              });
              
              console.log(`Transaction sent with high priority: ${txid}`);
              break;
            } catch (sendError) {
              retriesLeft--;
              console.error(`Error sending transaction (${retriesLeft} retries left):`, sendError.message);
              
              if (retriesLeft <= 0) {
                throw sendError;
              }
              
              // Wait before retry with exponential backoff but shorter intervals
              await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, 5 - retriesLeft)));
            }
          }
          
          if (!txid) {
            throw new Error('Failed to send transaction after multiple retries');
          }
          
          console.log('Waiting for confirmation with extended timeout...');
          
          // Use a more robust confirmation strategy with longer timeout
          try {
            const confirmation = await this.state.connection.confirmTransaction(
              {
                signature: txid, 
                blockhash: transaction.message.recentBlockhash, 
                lastValidBlockHeight: 150000000
              },
              'confirmed'
            );
            
            if (confirmation.value.err) {
              console.error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
              return false;
            }
            
            console.log(`Transaction confirmed successfully!`);
          } catch (confirmError) {
            console.error(`Confirmation timeout, checking transaction status directly...`);
            
            // Enhanced transaction status checker with more retries
            const status = await this.checkTransactionStatusExtended(txid, 10);
            
            if (!status.success) {
              console.error(`Transaction failed: ${status.error || 'Unknown error'}`);
              return false;
            }
            
            console.log(`Transaction confirmed with manual status check!`);
          }
          
          // Get output token name and amount information from the quote
          const outputMint = quoteData.outputMint;
          const outputTokenName = this.getTokenNameByAddress(outputMint) || 'Unknown';
          const outputDecimals = this.TOKEN_DECIMALS[outputTokenName] || 9;
          const outputAmount = parseInt(quoteData.outAmount) / Math.pow(10, outputDecimals);
          
          console.log(`Swap details: ${amount} ${inputToken} -> ${outputAmount.toFixed(6)} ${outputTokenName}`);
          
          // Add delay after transaction to ensure blockchain state is updated
          console.log('Transaction confirmed, waiting for blockchain state update...');
          await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds wait
          
          // Force a balance refresh to get updated balances
          await this.refreshWalletBalances(true);
          
          // Return success with transaction details
          const result = {
            success: true,
            txid,
            inputAmount: amount,
            outputAmount,
            inputToken,
            outputToken: outputTokenName
          };
          
          return result;
        } catch (error) {
          console.error('Error executing high-priority swap:', error);
          
          // Send detailed error to logs
          console.error('Error details:', error.stack);
          
          // Try to recover from RPC errors
          if (error.message && (
              error.message.includes('network') || 
              error.message.includes('timeout') || 
              error.message.includes('rate limit')
          )) {
            console.log('Attempting to reconnect to RPC endpoint...');
            try {
              await this.setupConnection();
            } catch (connError) {
              console.error('Failed to reconnect:', connError);
            }
          }
          
          return false;
        }
      }

      async getJupiterQuoteForConsolidation(inputToken, outputToken, amount, slippageBps, directRoutePreferred) {
        try {
          const inputDecimals = this.TOKEN_DECIMALS[inputToken] || 9;
          const inputAmountLamports = Math.floor(amount * Math.pow(10, inputDecimals));
          
          // Enhanced quote parameters for consolidation
          const params = new URLSearchParams({
            inputMint: this.TOKEN_ADDRESSES[inputToken],
            outputMint: this.TOKEN_ADDRESSES[outputToken],
            amount: inputAmountLamports.toString(),
            slippageBps: slippageBps.toString(),
            onlyDirectRoutes: directRoutePreferred.toString(),
            asLegacyTransaction: 'false',
            computeUnitPriceMicroLamports: '20000' // Higher compute unit price for consolidation
          });
          
          const url = `https://quote-api.jup.ag/v6/quote?${params.toString()}`;
          
          console.log(`Requesting optimized Jupiter quote for consolidation: ${url}`);
          
          // Implement retry logic with 5 second timeout
          const fetchWithRetry = async (url, retries = 3) => {
            for (let i = 0; i < retries; i++) {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                  const errorText = await response.text();
                  throw new Error(`HTTP error ${response.status}: ${errorText}`);
                }
                
                return await response.json();
              } catch (error) {
                console.error(`Quote fetch attempt ${i+1}/${retries} failed:`, error.message);
                
                if (i === retries - 1) throw error;
                
                // Wait before retry with exponential backoff
                const delay = Math.min(5000, 1000 * Math.pow(2, i));
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
          };
          
          const quoteData = await fetchWithRetry(url);
          
          // Validate quote data
          if (!quoteData || !quoteData.outAmount) {
            throw new Error('Invalid quote data returned');
          }
          
          // Calculate and log the expected output
          const outputDecimals = this.TOKEN_DECIMALS[outputToken] || 9;
          const outputAmount = parseInt(quoteData.outAmount) / Math.pow(10, outputDecimals);
          
          console.log(`Consolidation quote received: ${amount} ${inputToken} -> ${outputAmount.toFixed(6)} ${outputToken}`);
          
          // Log route information if available
          if (quoteData.routePlan && quoteData.routePlan.length > 0) {
            console.log('Consolidation route details:');
            quoteData.routePlan.forEach((hop, index) => {
              console.log(`  Hop ${index+1}: ${hop.swapInfo?.label || 'Unknown'} (${hop.percent}%)`);
            });
          }
          
          return quoteData;
        } catch (error) {
          console.error('Error getting consolidation quote:', error);
          return null;
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
          
          // Record profit for tracking
          this.recordProfit(/* profit calculations */);
          
          // IMMEDIATE CONSOLIDATION - Immediately convert any non-SOL tokens back to SOL
          if (opportunity.outputToken !== 'SOL') {
            console.log('Auto-consolidating trade profits to SOL immediately...');
            
            // Wait for blockchain state to settle before consolidation
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Refresh balances to get updated token amounts
            await this.refreshWalletBalances(true);
            
            // Get current balance of output token
            const tokenBalance = this.serverState.balances[opportunity.outputToken] || 0;
            
            if (tokenBalance > 0.005) { // Minimum amount to consolidate
              // Calculate 90% of balance to use for consolidation
              const consolidationAmount = tokenBalance * 0.9;
              
              // Execute consolidation with multiple retries
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  const slippage = 500 + (attempt * 100); // Increase slippage with each attempt
                  
                  // Get quote for consolidation
                  const consolidationQuote = await this.getJupiterQuoteForConsolidation(
                    opportunity.outputToken,
                    'SOL',
                    consolidationAmount,
                    slippage,
                    true
                  );
                  
                  if (!consolidationQuote) continue;
                  
                  // Execute consolidation
                  const consolidationResult = await this.executeJupiterSwapWithHighPriority(
                    consolidationQuote,
                    consolidationAmount,
                    opportunity.outputToken
                  );
                  
                  if (consolidationResult && consolidationResult.success) {
                    console.log(`✅ Profit consolidated: ${consolidationResult.outputAmount.toFixed(6)} SOL`);
                    break;
                  }
                } catch (error) {
                  console.error(`Consolidation attempt ${attempt+1} failed:`, error);
                }
              }
            }
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
    // Calculate minimum required GUARANTEED profit (75% of slippage - increased from 50%)
    const slippagePercentage = slippageBps / 100;
    const minRequiredProfit = slippagePercentage * 0.75;
    
    // Get the estimated profit percentage
    const estimatedProfitPercentage = Math.abs(opportunity.percentChange || 0);
    
    // Calculate network fee as a percentage with HIGHER estimate
    const feePercentage = (opportunity.feePercentage || 0) * 1.5; // 50% buffer on fee estimation
    
    // Net profit after fee with safety margin
    const netProfitPercentage = estimatedProfitPercentage * 0.9 - feePercentage; // 10% safety buffer
    
    // Calculate what percentage of slippage this profit represents
    const profitToSlippageRatio = netProfitPercentage / slippagePercentage;
    
    // Only proceed if profit is at least 75% of slippage after fees with safety margin
    return netProfitPercentage >= minRequiredProfit;
  }

  async consolidateTradeProfit() {
    try {
      console.log('Analyzing market before consolidation...');
      
      // 1. Get all token balances
      await this.refreshWalletBalances(true);
      
      // 2. Find tokens with non-SOL balances that can be converted to SOL
      const tokensToConsolidate = [];
      const minAmountToConsolidate = 0.005; // Lower threshold to ensure small profits are captured
      
      for (const [token, amount] of Object.entries(this.serverState.balances)) {
        // Skip SOL and tokens with balances below threshold
        if (token === 'SOL' || amount < minAmountToConsolidate) continue;
        
        // Always attempt to consolidate any non-SOL token balance
        tokensToConsolidate.push({
          token,
          amount,
          pair: `${token}/SOL`
        });
      }
      
      // 3. Execute consolidation trades with multiple retries and safety checks
      for (const info of tokensToConsolidate) {
        console.log(`Consolidating ${info.amount.toFixed(6)} ${info.token} to SOL...`);
        
        // Multiple retry attempts with different slippage values
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            // Use more conservative amounts - use 90% of balance to account for fees
            const tradeAmount = info.amount * 0.9;
            
            // Increase slippage tolerance for consolidation
            const slippageBps = 500 + (attempt * 100); // Increase slippage with each attempt
            
            // Get quote with direct route preference
            const quoteData = await this.getJupiterQuoteForConsolidation(
              info.token,
              'SOL',
              tradeAmount,
              slippageBps,
              true // Prefer direct routes
            );
            
            if (!quoteData || !quoteData.outAmount) {
              console.log(`Failed to get quote, retrying with higher slippage...`);
              continue;
            }
            
            // Execute trade with higher compute unit limit for consolidation
            const result = await this.executeJupiterSwapWithHighPriority(
              quoteData,
              tradeAmount,
              info.token
            );
            
            if (result && result.success) {
              console.log(`Successfully consolidated ${info.token} to ${result.outputAmount.toFixed(6)} SOL`);
              break; // Success, exit retry loop
            }
          } catch (error) {
            console.error(`Error during consolidation attempt ${attempt+1}: ${error.message}`);
            // Continue to next attempt
          }
        }
      }
      
      // 4. Final balance check after all consolidations
      await this.refreshWalletBalances(true);
      return true;
    } catch (error) {
      console.error('Error during profit consolidation:', error);
      return false;
    }
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
    
    // Check if the bot instance has a wallet
    if (!this.bot || !this.bot.state) {
      console.error(chalk.red('ERROR: Bot state not properly initialized'));
      throw new Error('Bot state not properly initialized');
    }
    
    // Check if wallet is properly configured in the bot's state
    if (!this.bot.state.wallet) {
      console.error(chalk.red('ERROR: No wallet configured in bot state'));
      
      // Try to recover by copying from the bot object
      if (this.bot.wallet) {
        console.log(chalk.yellow('Found wallet in bot object, copying to state'));
        this.bot.state.wallet = this.bot.wallet;
        this.wallet = this.bot.wallet;
      } else {
        console.error(chalk.red('NO WALLET FOUND - CANNOT CONTINUE'));
        throw new Error('No wallet configured. Trading requires a valid wallet.');
      }
    } else {
      // Ensure we have a reference to the wallet
      this.wallet = this.bot.state.wallet;
    }
    
    // Check if wallet has a public key
    if (!this.wallet.publicKey) {
      console.error(chalk.red('ERROR: Wallet does not have a public key'));
      throw new Error('Invalid wallet configuration: missing public key');
    }
    
    // Print wallet address
    const walletAddress = this.wallet.publicKey.toString();
    console.log(chalk.green(`Wallet configured: ${walletAddress}`));
    
    // Make sure the wallet has a secretKey for signing transactions
    if (!this.wallet.secretKey) {
      console.warn(chalk.yellow('WARNING: Wallet object does not contain secretKey property'));
      console.warn(chalk.yellow('Checking for keypair properties...'));
      
      // Try to find alternative signing capabilities
      if (typeof this.wallet.sign === 'function') {
        console.log(chalk.green('Wallet has sign method, can be used for transactions'));
      } else if (typeof this.wallet.signTransaction === 'function') {
        console.log(chalk.green('Wallet has signTransaction method, can be used for transactions'));
      } else {
        console.error(chalk.red('Wallet cannot sign transactions - missing required methods'));
        throw new Error('Wallet cannot sign transactions - missing required methods');
      }
    }
    
    console.log(chalk.green('✓ Wallet verification completed successfully'));
    return true;
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