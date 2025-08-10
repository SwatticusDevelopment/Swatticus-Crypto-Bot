/**
 * No-debug starter for Solana Trading Bot
 * This script launches the trading bot with debugging disabled
 */

// Disable node debugger
process.env.NODE_OPTIONS = '--no-deprecation';
process.removeAllListeners('SIGUSR1');

// Load environment variables from .env file
require('dotenv').config();

// Check environment before proceeding
if (!process.env.PRIVATE_KEY) {
  console.error('\x1b[31mERROR: PRIVATE_KEY not found in .env file\x1b[0m');
  process.exit(1);
}

if (!process.env.RPC_ENDPOINT) {
  console.warn('\x1b[33mWARNING: RPC_ENDPOINT not specified, using default Solana RPC\x1b[0m');
}

// Import the server
try {
  const TradingBotServer = require('./src/server');
  
  console.log('\x1b[34mStarting Solana Trading Bot Server (no debug mode)...\x1b[0m');
  
  // Create and start server
  const server = new TradingBotServer();
  server.start();
  
  console.log('\x1b[32mServer started successfully!\x1b[0m');
  console.log('\x1b[32mAccess the dashboard at http://localhost:' + (process.env.HTTP_PORT || 3000) + '\x1b[0m');
  
} catch (error) {
  console.error('\x1b[31mFATAL ERROR:', error.message, '\x1b[0m');
  console.error(error.stack);
  process.exit(1);
}