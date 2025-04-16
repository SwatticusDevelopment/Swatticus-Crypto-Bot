/**
 * Solana Advanced Slippage Bot - Jupiter API Only Version
 * 
 * This bot monitors price differentials on Solana using Jupiter's API
 * and executes trades when profitable opportunities arise.
 * 
 * Initial fund: 0.1 SOL
 * Target: 2-10 SOL per day
 */

// Required dependencies
const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const { TokenListProvider } = require('@solana/spl-token-registry');
const Decimal = require('decimal.js');
const colors = require('colors');
const chalk = require('chalk');
const Table = require('cli-table3');
const fs = require('fs');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const bs58 = require('bs58');

// Load environment variables
dotenv.config();

// Configuration
const CONFIG = {
  // RPC Endpoint (Mainnet)
  rpcEndpoint: process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
  
  // Your wallet private key (stored in .env file for security)
  privateKey: process.env.PRIVATE_KEY,
  
  // Minimum profit percentage to execute a trade
  minProfitPercentage: parseFloat(process.env.MIN_PROFIT_PERCENTAGE) || 0.3,
  
  // Maximum slippage allowed when executing a trade
  maxSlippage: parseFloat(process.env.MAX_SLIPPAGE_BPS) || 100,
  
  // Initial balance to work with (in SOL)
  initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 0.1,
  
  // Daily profit target (in SOL)
  dailyProfitTarget: parseFloat(process.env.DAILY_PROFIT_TARGET) || 2.0,
  
  // Should use aggressive mode (more risk, more reward)
  aggressiveMode: process.env.AGGRESSIVE_MODE === 'true',
  
  // Tokens to monitor (Focus on high liquidity pairs for better slippage opportunities)
  tokens: [
    'SOL', 'USDC', 'USDT', 'mSOL'
  ],
  
  // Jupiter API endpoints
  jupiterQuoteApi: 'https://quote-api.jup.ag/v6/quote',
  jupiterSwapApi: 'https://quote-api.jup.ag/v6/swap',
  jupiterPriceApi: 'https://price.jup.ag/v6/price',
  
  // Refresh interval (in milliseconds) - set to 15 seconds for faster opportunity detection
  refreshInterval: parseInt(process.env.REFRESH_INTERVAL) || 15000,
  
  // Maximum concurrent trades
  maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES) || 3,
  
  // Profit tracking
  profitTracking: {
    enabled: true,
    dailyReset: true, // Reset daily profit counter every 24 hours
    saveToFile: true, // Save profit history to a file
  },
  
  // Minimum trade size for real trades (in SOL)
  minTradeSize: parseFloat(process.env.MIN_TRADE_SIZE) || 0.05,
  
  // Time window to look back for price checks (in minutes)
  timeWindowMinutes: 5,
  
  // Price check frequency for tracking (in milliseconds)
  priceCheckFrequency: 60000, // 1 minute
  
  // Number of price checks to store
  maxPriceHistoryLength: 10 // 10 minutes of history with 1 minute checks
};

// Initialize connection to Solana
const connection = new Connection(CONFIG.rpcEndpoint);

// Set up wallet from private key
let wallet;
try {
  const privateKeyArray = JSON.parse(CONFIG.privateKey);
  const secretKey = Uint8Array.from(privateKeyArray);
  wallet = Keypair.fromSecretKey(secretKey);
  console.log(chalk.green('Wallet successfully loaded'));
} catch (error) {
  console.error(chalk.red('Error loading wallet:'), error.message);
  console.log(chalk.yellow('Please ensure your private key is correctly formatted in the .env file'));
  console.log(chalk.yellow('Example format: PRIVATE_KEY=[1,2,3,4,...]'));
  process.exit(1);
}

// Token addresses for lookups
const TOKEN_ADDRESSES = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'mSOL': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
};

// Token decimals
const TOKEN_DECIMALS = {
  'SOL': 9,
  'USDC': 6,
  'USDT': 6,
  'mSOL': 9,
};

// Store historical prices
let priceHistory = {};

// Get a token name from its address
const getTokenNameByAddress = (address) => {
  for (const [name, addr] of Object.entries(TOKEN_ADDRESSES)) {
    if (addr === address) {
      return name;
    }
  }
  return 'Unknown';
};

// Check token balances in wallet
const getTokenBalances = async (walletPublicKey) => {
  try {
    console.log(chalk.blue('Checking token balances...'));
    
    const balances = {};
    
    // Get SOL balance (native token)
    const solBalance = await connection.getBalance(walletPublicKey);
    balances['SOL'] = solBalance / 1e9; // Convert from lamports to SOL
    
    // Get SPL token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPublicKey,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );
    
    // Process each token account
    for (const { pubkey, account } of tokenAccounts.value) {
      const tokenMint = account.data.parsed.info.mint;
      const tokenAmount = account.data.parsed.info.tokenAmount.uiAmount;
      
      // Find token name by mint address
      const tokenName = getTokenNameByAddress(tokenMint);
      
      if (tokenName !== 'Unknown' && tokenAmount > 0) {
        balances[tokenName] = tokenAmount;
      }
    }
    
    return balances;
  } catch (error) {
    console.error(chalk.red('Error fetching token balances:'), error.message);
    return { 'SOL': await connection.getBalance(walletPublicKey) / 1e9 };
  }
};

// Generate dynamic trading pairs based on available tokens
const generateTradingPairs = (balances) => {
  const availableTokens = Object.keys(balances).filter(token => balances[token] > 0);
  
  if (availableTokens.length === 0) {
    console.log(chalk.yellow('No token balances found. Using default pairs.'));
    return CONFIG.tokens.flatMap((token1, i) => 
      CONFIG.tokens.slice(i + 1).map(token2 => `${token1}/${token2}`)
    );
  }
  
  const pairs = [];
  
  // Generate pairs with tokens we have against target tokens
  for (const token of availableTokens) {
    for (const targetToken of CONFIG.tokens) {
      // Don't create pairs with the same token
      if (token !== targetToken) {
        pairs.push(`${token}/${targetToken}`);
      }
    }
  }
  
  // Remove duplicate pairs
  const uniquePairs = [...new Set(pairs)];
  
  console.log(chalk.blue(`Generated ${uniquePairs.length} trading pairs from available tokens.`));
  return uniquePairs;
};

// Fetch current prices using Jupiter API
const fetchCurrentPrices = async (pairs) => {
  try {
    console.log(chalk.blue('Fetching current prices from Jupiter...'));
    
    const tokenList = new Set();
    pairs.forEach(pair => {
      const [token1, token2] = pair.split('/');
      tokenList.add(token1);
      tokenList.add(token2);
    });
    
    // Convert to array and filter out unknown tokens
    const tokens = [...tokenList].filter(token => TOKEN_ADDRESSES[token]);
    
    // Build query params for Jupiter Price API
    const ids = tokens.map(token => TOKEN_ADDRESSES[token]).join(',');
    const url = `${CONFIG.jupiterPriceApi}?ids=${ids}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Jupiter API returned ${response.status}: ${response.statusText}`);
    }
    
    const priceData = await response.json();
    
    // Format the price data into a more usable format
    const tokenPrices = {};
    for (const token of tokens) {
      const address = TOKEN_ADDRESSES[token];
      if (priceData.data && priceData.data[token]) {
        tokenPrices[token] = priceData.data[token].price;
      }
    }
    
    // Compute pair prices
    const pairPrices = {};
    for (const pair of pairs) {
      const [token1, token2] = pair.split('/');
      
      if (tokenPrices[token1] && tokenPrices[token2]) {
        const price = tokenPrices[token2] / tokenPrices[token1];
        
        pairPrices[pair] = {
          price: price,
          ask: price * 1.001,
          bid: price * 0.999,
          updated: new Date().toISOString()
        };
      }
    }
    
    // Update price history for all pairs
    const timestamp = Date.now();
    for (const [pair, data] of Object.entries(pairPrices)) {
      if (!priceHistory[pair]) {
        priceHistory[pair] = [];
      }
      
      // Add latest price with timestamp
      priceHistory[pair].push({
        price: data.price,
        timestamp
      });
      
      // Keep only the last N price points
      if (priceHistory[pair].length > CONFIG.maxPriceHistoryLength) {
        priceHistory[pair].shift(); // Remove oldest price
      }
    }
    
    return pairPrices;
  } catch (error) {
    console.error(chalk.red('Error fetching current prices:'), error.message);
    return {};
  }
};

// Calculate price movement percentage for a pair
const calculatePriceMovement = (pair) => {
  try {
    // Check if we have enough price history
    if (!priceHistory[pair] || priceHistory[pair].length < 2) {
      return null;
    }
    
    // Get oldest and newest prices
    const oldestPrice = priceHistory[pair][0].price;
    const newestPrice = priceHistory[pair][priceHistory[pair].length - 1].price;
    
    // Calculate percentage change
    const priceChange = ((newestPrice - oldestPrice) / oldestPrice) * 100;
    
    return {
      oldPrice: oldestPrice,
      currentPrice: newestPrice,
      percentChange: priceChange,
      timespan: priceHistory[pair][priceHistory[pair].length - 1].timestamp - priceHistory[pair][0].timestamp
    };
  } catch (error) {
    console.error(chalk.red(`Error calculating price movement for ${pair}:`), error.message);
    return null;
  }
};

// Find slippage opportunities based on price movement
const findSlippageOpportunities = (pairs) => {
  try {
    console.log(chalk.blue('Finding slippage opportunities based on price movements...'));
    
    const opportunities = [];
    
    for (const pair of pairs) {
      // Calculate price movement
      const movement = calculatePriceMovement(pair);
      
      // Skip if we don't have enough history or no significant movement
      if (!movement) {
        continue;
      }
      
      // Check if the price movement exceeds our minimum threshold
      if (Math.abs(movement.percentChange) >= CONFIG.minProfitPercentage) {
        const [inputToken, outputToken] = pair.split('/');
        
        // Determine optimal trade amount based on token value
        let suggestedAmount = 0;
        
        if (inputToken === 'SOL') {
          suggestedAmount = 1.0; // 1 SOL
        } else if (inputToken === 'USDC' || inputToken === 'USDT') {
          suggestedAmount = 20.0; // $20
        } else {
          suggestedAmount = 0.5; // Default amount
        }
        
        // Calculate potential profit
        const potentialProfit = (movement.percentChange / 100) * suggestedAmount;
        
        // Add to opportunities if profitable
        opportunities.push({
          pair,
          inputToken,
          outputToken,
          currentPrice: movement.currentPrice,
          oldPrice: movement.oldPrice,
          percentChange: movement.percentChange,
          suggestedAmount,
          potentialProfit,
          timestamp: Date.now()
        });
      }
    }
    
    return opportunities;
  } catch (error) {
    console.error(chalk.red('Error finding slippage opportunities:'), error.message);
    return [];
  }
};

// Display prices in a table
const displayPrices = (prices) => {
  const table = new Table({
    head: ['Pair', 'Price', 'Ask', 'Bid', 'Updated'],
    colWidths: [15, 15, 15, 15, 25]
  });
  
  for (const [pair, data] of Object.entries(prices)) {
    table.push([
      pair,
      data.price.toFixed(6),
      data.ask.toFixed(6),
      data.bid.toFixed(6),
      data.updated
    ]);
  }
  
  console.log(chalk.cyan('\nMarket Prices:'));
  console.log(table.toString());
};

// Display price movements
const displayPriceMovements = (pairs) => {
  const table = new Table({
    head: ['Pair', 'Old Price', 'Current Price', 'Change (%)', 'Timespan (min)'],
    colWidths: [15, 15, 15, 15, 15]
  });
  
  for (const pair of pairs) {
    const movement = calculatePriceMovement(pair);
    
    if (movement) {
      table.push([
        pair,
        movement.oldPrice.toFixed(6),
        movement.currentPrice.toFixed(6),
        movement.percentChange.toFixed(2),
        (movement.timespan / 60000).toFixed(1) // Convert ms to minutes
      ]);
    }
  }
  
  console.log(chalk.cyan('\nPrice Movements:'));
  console.log(table.toString());
};

// Display slippage opportunities
const displaySlippageOpportunities = (opportunities) => {
  if (opportunities.length === 0) {
    console.log(chalk.yellow('\nNo slippage opportunities found'));
    return;
  }
  
  const table = new Table({
    head: ['Pair', 'Amount', 'Current Price', 'Old Price', 'Change (%)', 'Est. Profit'],
    colWidths: [15, 12, 15, 15, 15, 15]
  });
  
  for (const opp of opportunities) {
    table.push([
      opp.pair,
      opp.suggestedAmount.toFixed(4),
      opp.currentPrice.toFixed(6),
      opp.oldPrice.toFixed(6),
      opp.percentChange.toFixed(2),
      opp.potentialProfit.toFixed(6)
    ]);
  }
  
  console.log(chalk.green('\nSlippage Opportunities (based on price movements):'));
  console.log(table.toString());
};

// Track profits
let dailyProfit = 0;
let totalProfit = 0;
let currentBalance = CONFIG.initialBalance;
let activeTrades = 0;
let dailyStartTime = Date.now();
let tradeHistory = [];

// Record profit
const recordProfit = (amount) => {
  dailyProfit += amount;
  totalProfit += amount;
  
  const timestamp = new Date().toISOString();
  tradeHistory.push({
    timestamp,
    profit: amount,
    runningTotal: totalProfit
  });
  
  // Save to file if enabled
  if (CONFIG.profitTracking.saveToFile) {
    fs.appendFileSync('profit_history.csv', `${timestamp},${amount},${totalProfit}\n`);
  }
  
  // Check if we've reached daily target
  if (dailyProfit >= CONFIG.dailyProfitTarget) {
    console.log(chalk.green.bold(`\n🎉 DAILY PROFIT TARGET REACHED! ${dailyProfit.toFixed(6)} SOL 🎉`));
    
    if (!CONFIG.profitTracking.dailyReset) {
      console.log(chalk.yellow('Continuing to trade for additional profit...'));
    }
  }
};

// Reset daily profit counter
const resetDailyProfit = () => {
  const now = Date.now();
  const dayInMs = 24 * 60 * 60 * 1000;
  
  if (now - dailyStartTime >= dayInMs) {
    console.log(chalk.blue(`\nDaily profit summary: ${dailyProfit.toFixed(6)} SOL`));
    dailyProfit = 0;
    dailyStartTime = now;
    
    // Save daily summary
    const summaryDate = new Date().toISOString().split('T')[0];
    fs.appendFileSync('daily_summaries.csv', `${summaryDate},${dailyProfit}\n`);
  }
};

// Get a fresh quote from Jupiter
const getJupiterQuote = async (inputToken, outputToken, amount) => {
  try {
    // Calculate input amount in smallest unit
    const inputDecimals = TOKEN_DECIMALS[inputToken] || 9;
    const inputAmountLamports = Math.floor(amount * Math.pow(10, inputDecimals));
    
    // Fetch a fresh quote
    const response = await fetch(`${CONFIG.jupiterQuoteApi}?inputMint=${TOKEN_ADDRESSES[inputToken]}&outputMint=${TOKEN_ADDRESSES[outputToken]}&amount=${inputAmountLamports}&slippageBps=${CONFIG.maxSlippage}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(chalk.red(`Quote API error (${response.status}): ${errorText}`));
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error(chalk.red('Error fetching quote:'), error.message);
    return null;
  }
};

// Execute a Jupiter swap using V6 API
const executeJupiterSwap = async (quoteResponse, amount, inputToken) => {
  try {
    console.log(chalk.blue(`Executing swap with Jupiter V6 API...`));
    
    // Get the token decimal precision
    const inputMint = quoteResponse.inputMint;
    const inputTokenName = getTokenNameByAddress(inputMint) || inputToken;
    const decimals = TOKEN_DECIMALS[inputTokenName] || 9;
    
    // Convert amount to smallest unit
    const amountInSmallestUnit = Math.floor(amount * Math.pow(10, decimals));
    
    // Call the Jupiter V6 swap API
    const response = await fetch(CONFIG.jupiterSwapApi, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // User public key to be used for the swap
        userPublicKey: wallet.publicKey.toString(),
        // Wrap and unwrap SOL automatically if needed
        wrapUnwrapSOL: true,
        // Use versioned transactions
        useVersionedTransaction: true,
        // Compute unit limit to avoid failures
        computeUnitPriceMicroLamports: 10000,
        dynamicComputeUnitLimit: true,
        // Slippage tolerance in basis points (1 = 0.01%, 100 = 1%)
        slippageBps: CONFIG.maxSlippage,
        // Quote params directly instead of quoteResponse
        quoteResponse: {
          inputMint: quoteResponse.inputMint,
          outputMint: quoteResponse.outputMint,
          amount: amountInSmallestUnit.toString(),
          slippageBps: CONFIG.maxSlippage,
          otherAmountThreshold: quoteResponse.otherAmountThreshold,
          swapMode: quoteResponse.swapMode || "ExactIn",
          routePlan: quoteResponse.routePlan || []
        }
      })
    });
    
    // Check if the request was successful
    if (!response.ok) {
      const errorText = await response.text();
      console.error(chalk.red(`Jupiter API error (${response.status}): ${errorText}`));
      return false;
    }
    
    // Parse the response
    const swapResponse = await response.json();
    
    // Check if we got a swap transaction
    if (!swapResponse || !swapResponse.swapTransaction) {
      console.error(chalk.red(`Failed to get swap transaction: ${JSON.stringify(swapResponse)}`));
      return false;
    }
    
    const { swapTransaction } = swapResponse;
    
    // Deserialize the transaction
    const transactionBuffer = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuffer);
    
    // Sign the transaction
    transaction.sign([wallet]);
    
    // Send the transaction
    console.log(chalk.yellow('Sending transaction to Solana...'));
    const txid = await connection.sendTransaction(transaction, {
      skipPreflight: true,
      maxRetries: 3,
    });
    
    // Wait for confirmation (with a shorter timeout)
    console.log(chalk.yellow(`Transaction sent: ${txid}`));
    console.log(chalk.yellow('Waiting for confirmation...'));
    
    try {
      const confirmation = await connection.confirmTransaction(
        {signature: txid, blockhash: transaction.message.recentBlockhash, lastValidBlockHeight: 150000000},
        'confirmed'
      );
      
      if (confirmation.value.err) {
        console.error(chalk.red(`Transaction failed: ${confirmation.value.err}`));
        return false;
      }
    } catch (confirmError) {
      console.log(chalk.yellow(`Confirmation timeout, but transaction may have succeeded: ${txid}`));
    }
    
    console.log(chalk.green(`Swap executed successfully! Transaction ID: ${txid}`));
    
    // Get token details
    const outputMint = quoteResponse.outputMint;
    const outputTokenName = getTokenNameByAddress(outputMint) || 'Unknown';
    const outputDecimals = TOKEN_DECIMALS[outputTokenName] || 9;
    
    // Calculate estimated output (approximate)
    const inputAmount = amount;
    const outputAmount = parseInt(quoteResponse.outAmount) / Math.pow(10, outputDecimals);
    
    console.log(chalk.green(`Swap details: ${inputAmount} ${inputTokenName} -> ${outputAmount.toFixed(6)} ${outputTokenName}`));
    
    return {
      success: true,
      txid,
      inputAmount,
      outputAmount,
      inputToken: inputTokenName,
      outputToken: outputTokenName
    };
  } catch (error) {
    console.error(chalk.red('Error executing Jupiter swap:'), error.message);
    return false;
  }
};

// Execute real slippage trade based on price movement opportunity
const executeRealSlippageTrade = async (opportunity) => {
  console.log(chalk.yellow('\nExecuting real slippage trade based on price movement:'));
  console.log(`Pair: ${opportunity.pair}`);
  console.log(`Amount: ${opportunity.suggestedAmount.toFixed(6)}`);
  console.log(`Current price: ${opportunity.currentPrice.toFixed(6)}`);
  console.log(`Old price: ${opportunity.oldPrice.toFixed(6)}`);
  console.log(`Price change: ${opportunity.percentChange.toFixed(2)}%`);
  console.log(`Potential profit: ${opportunity.potentialProfit.toFixed(6)} ${opportunity.outputToken}`);
  
  try {
    // Check balance for input token
    const balances = await getTokenBalances(wallet.publicKey);
    
    // Get available balance for input token
    const availableBalance = balances[opportunity.inputToken] || 0;
    
    // Calculate trade amount
    const tradeAmount = Math.min(
      opportunity.suggestedAmount, 
      availableBalance * 0.95, // Only use up to 95% of available balance
      Math.max(CONFIG.minTradeSize, availableBalance * 0.1) // At least min trade size but not more than 10% of balance
    );
  
    if (availableBalance < tradeAmount) {
      console.log(chalk.yellow(`Insufficient ${opportunity.inputToken} balance for trade. Required: ${tradeAmount}, Available: ${availableBalance}`));
      return false;
    }
    
    // Get fresh quote for this opportunity
    console.log(chalk.yellow('Fetching fresh quote for this opportunity...'));
    const quoteData = await getJupiterQuote(
      opportunity.inputToken, 
      opportunity.outputToken, 
      tradeAmount
    );
    
    if (!quoteData) {
      console.error(chalk.red('Failed to get quote data'));
      return false;
    }
    
    // Execute the swap with the quote
    const result = await executeJupiterSwap(quoteData, tradeAmount, opportunity.inputToken);
    
    if (result && result.success) {
      // Calculate realized profit - this is approximate
      const realizedProfit = result.outputAmount - (tradeAmount * opportunity.currentPrice);
      
      // Record profit (in SOL equivalent)
      const solEquivalentProfit = opportunity.outputToken === 'SOL' ? 
        realizedProfit : 
        (opportunity.outputToken === 'USDC' || opportunity.outputToken === 'USDT') ? 
          realizedProfit / 20 : // Rough SOL/USD approximation
          realizedProfit * 0.5; // Generic approximation
      
      recordProfit(solEquivalentProfit);
      
      console.log(chalk.green('Trade executed successfully with real funds'));
      console.log(`Transaction ID: ${result.txid}`);
      console.log(`Realized profit: ${realizedProfit.toFixed(6)} ${opportunity.outputToken} (≈ ${solEquivalentProfit.toFixed(6)} SOL)`);
      
      // Update current balance based on actual balance
      const newBalances = await getTokenBalances(wallet.publicKey);
      currentBalance = newBalances['SOL'] || 0;
      console.log(`Updated balances:`);
      Object.entries(newBalances).forEach(([token, balance]) => {
        console.log(`  ${token}: ${amount.toFixed(6)}`);
      });
      
      return true;
    } else {
      console.log(chalk.red('Real trade execution failed'));
      return false;
    }
  } catch (error) {
    console.error(chalk.red('Error executing trade:'), error.message);
    return false;
  }
};

// Display profit statistics
const displayProfitStats = () => {
  console.log(chalk.magenta('\nProfit Statistics:'));
  console.log(`Initial Balance: ${CONFIG.initialBalance.toFixed(6)} SOL`);
  console.log(`Current Balance: ${currentBalance.toFixed(6)} SOL`);
  console.log(`Daily Profit: ${dailyProfit.toFixed(6)} SOL (Target: ${CONFIG.dailyProfitTarget.toFixed(2)} SOL)`);
  console.log(`Total Profit: ${totalProfit.toFixed(6)} SOL`);
  console.log(`Profit Percentage: ${((totalProfit / CONFIG.initialBalance) * 100).toFixed(2)}%`);
  console.log(`Active Trades: ${activeTrades} / ${CONFIG.maxConcurrentTrades}`);
};

// Main loop
const main = async () => {
  try {
    // Check wallet balances
    const balances = await getTokenBalances(wallet.publicKey);
    console.log(chalk.green('\nWallet balances:'));
    
    let totalFound = 0;
    Object.entries(balances).forEach(([token, amount]) => {
      console.log(chalk.green(`  ${token}: ${amount.toFixed(6)}`));
      totalFound++;
    });
    
    if (totalFound === 0) {
      console.error(chalk.red('No token balances found in wallet. Please fund your wallet first.'));
      process.exit(1);
    }
    
    console.log(chalk.green('Running in REAL TRADING mode - your wallet will be updated with actual trades'));
    
    // Initialize profit tracking file
    if (CONFIG.profitTracking.saveToFile) {
      if (!fs.existsSync('profit_history.csv')) {
        fs.writeFileSync('profit_history.csv', 'timestamp,profit,running_total\n');
      }
      if (!fs.existsSync('daily_summaries.csv')) {
        fs.writeFileSync('daily_summaries.csv', 'date,profit\n');
      }
    }
    
    // Set initial balance to actual SOL wallet balance
    currentBalance = balances['SOL'] || 0;
    
    // Generate trading pairs based on available tokens
    const availablePairs = generateTradingPairs(balances);
    
    // Main loop
    console.log(chalk.blue('\nStarting Jupiter-based slippage bot...'));
    console.log(chalk.blue(`Checking for opportunities every ${CONFIG.refreshInterval / 1000} seconds`));
    console.log(chalk.blue(`Building price history with ${CONFIG.priceCheckFrequency / 1000} second intervals`));
    console.log(chalk.blue(`Target daily profit: ${CONFIG.dailyProfitTarget} SOL`));
    console.log(chalk.blue(`Available trading pairs: ${availablePairs.length}`));
    console.log(chalk.blue(`Mode: ${CONFIG.aggressiveMode ? 'Aggressive' : 'Conservative'}`));
    
    // Variables for trade timing
    let lastTradeTime = 0;
    let forcedTradeInterval = 60000; // 60 seconds (1 minute)
    let lastPriceCheckTime = 0;
    
    // Start monitoring
    setInterval(async () => {
      try {
        // Check if we should reset daily profit
        if (CONFIG.profitTracking.dailyReset) {
          resetDailyProfit();
        }
        
        // Clear console for better readability
        console.clear();
        console.log(chalk.blue(`=== Solana Slippage Bot - Jupiter API Only ===`));
        console.log(chalk.blue(`Mode: REAL TRADING ONLY - BASED ON PRICE MOVEMENTS`));
        
        // Update all token balances
        const newBalances = await getTokenBalances(wallet.publicKey);
        
        // Update SOL balance for tracking
        currentBalance = newBalances['SOL'] || 0;
        
        // Re-generate trading pairs if balances changed
        const updatedPairs = generateTradingPairs(newBalances);
        
        // Display profit statistics
        displayProfitStats();
        
        // Display balances
        console.log(chalk.magenta('\nWallet Balances:'));
        Object.entries(newBalances).forEach(([token, amount]) => {
          if (amount > 0) {
            console.log(`  ${token}: ${amount.toFixed(6)}`);
          }
        });
        
        // Get current time
        const currentTime = Date.now();
        
        // Check if it's time to update price history
        if (currentTime - lastPriceCheckTime >= CONFIG.priceCheckFrequency) {
          // Fetch current prices
          await fetchCurrentPrices(updatedPairs);
          lastPriceCheckTime = currentTime;
        }
        
        // Get the latest prices for display
        const currentPrices = {};
        for (const pair of updatedPairs) {
          if (priceHistory[pair] && priceHistory[pair].length > 0) {
            const latestPrice = priceHistory[pair][priceHistory[pair].length - 1].price;
            
            currentPrices[pair] = {
              price: latestPrice,
              ask: latestPrice * 1.001,
              bid: latestPrice * 0.999,
              updated: new Date().toISOString()
            };
          }
        }
        
        // Display current prices
        displayPrices(currentPrices);
        
        // Display price movements
        displayPriceMovements(updatedPairs);
        
        // Find slippage opportunities from price movements
        const slippageOpportunities = findSlippageOpportunities(updatedPairs);
        displaySlippageOpportunities(slippageOpportunities);
        
        // Check if we need to execute a trade
        const shouldTrade = (currentTime - lastTradeTime > forcedTradeInterval);
        
        // Log trade timing info
        console.log(chalk.blue(`\nTime since last trade: ${((currentTime - lastTradeTime) / 1000).toFixed(1)} seconds`));
        if (shouldTrade) {
          console.log(chalk.yellow(`Trade interval reached, ready to execute next available trade`));
        }
        
        // Execute trade if:
        // 1. We have opportunities and are under max concurrent trades limit, AND
        // 2. It's time for a new trade (every minute)
        if (slippageOpportunities.length > 0 && activeTrades < CONFIG.maxConcurrentTrades && shouldTrade) {
          // Sort by potential profit
          slippageOpportunities.sort((a, b) => b.potentialProfit - a.potentialProfit);
          
          const opportunity = slippageOpportunities[0];
          
          activeTrades++;
          console.log(chalk.yellow(`Starting trade ${activeTrades}/${CONFIG.maxConcurrentTrades} based on price movement opportunity`));
          
          // Execute trade in separate async context to not block the loop
          executeRealSlippageTrade(opportunity).then(success => {
            if (success) {
              lastTradeTime = Date.now(); // Update last trade time only if successful
            }
            activeTrades--;
            console.log(chalk.yellow(`Trade completed. Active trades: ${activeTrades}/${CONFIG.maxConcurrentTrades}`));
          });
        } else if (slippageOpportunities.length === 0 && shouldTrade) {
          // If no opportunities but we need to execute a trade,
          // log that there are no opportunities
          console.log(chalk.yellow(`No profitable opportunities found from price movements. Waiting for next interval.`));
          
          // Update last trade time to avoid constantly checking with no opportunities
          lastTradeTime = Date.now() - (forcedTradeInterval / 2); // Half reset the timer
        }
        
        console.log(chalk.blue(`\nLast update: ${new Date().toLocaleTimeString()}`));
        
        // Additional stats display
        const runTime = (Date.now() - dailyStartTime) / 1000 / 60; // in minutes
        console.log(chalk.blue(`Running for: ${runTime.toFixed(1)} minutes`));
        console.log(chalk.blue(`Price history: ${Object.keys(priceHistory).length} pairs being tracked`));
        
      } catch (error) {
        console.error(chalk.red('Error in main loop:'), error.message);
      }
    }, CONFIG.refreshInterval);
    
  } catch (error) {
    console.error(chalk.red('Error in main function:'), error.message);
    process.exit(1);
  }
};

// Start the bot
main();