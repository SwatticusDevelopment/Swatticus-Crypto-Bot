// multichainConfig.js
require('dotenv').config();

const cfg = {
  REFRESH_INTERVAL_MS: parseInt(process.env.REFRESH_INTERVAL_MS || '1000', 10),
  MIN_USD_PROFIT: parseFloat(process.env.MIN_USD_PROFIT || '0.5'),
  CONSOLIDATE_MIN: parseFloat(process.env.CONSOLIDATE_MIN || '0.01'),
  USE_SOL: process.env.USE_SOL === 'true',
  USE_EVM: process.env.USE_EVM === 'true',

  // Solana
  SOL_RPC: process.env.SOL_RPC || 'https://api.mainnet-beta.solana.com',
  SOL_WALLET_SECRET: process.env.SOL_WALLET_SECRET || '',
  JUPITER_TOKENS_URL: process.env.JUPITER_TOKENS_URL || 'https://quote-api.jup.ag/v6/tokens',
  JUPITER_QUOTE_URL: process.env.JUPITER_QUOTE_URL || 'https://quote-api.jup.ag/v6/quote',
  JUPITER_SWAP_URL: process.env.JUPITER_SWAP_URL || 'https://quote-api.jup.ag/v6/swap',

  // EVM (defaults for Base)
  EVM_CHAIN: process.env.EVM_CHAIN || 'base',
  EVM_CHAIN_ID: parseInt(process.env.EVM_CHAIN_ID || '8453', 10),
  EVM_RPC_URL: process.env.EVM_RPC_URL || 'https://mainnet.base.org',
  EVM_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY || '',

  // Router choice + endpoints
  EVM_ROUTER: (process.env.EVM_ROUTER || '0x').toLowerCase(),
  OX_QUOTE_URL: process.env.OX_QUOTE_URL || 'https://api.0x.org/swap/v1/quote',
  OX_API_KEY: process.env.OX_API_KEY || '',
  ONEINCH_BASE_URL: process.env.ONEINCH_BASE_URL || 'https://api.1inch.dev',
  ONEINCH_API_KEY: process.env.ONEINCH_API_KEY || '',
  PARASWAP_BASE_URL: process.env.PARASWAP_BASE_URL || 'https://apiv5.paraswap.io',
  PARASWAP_API_KEY: process.env.PARASWAP_API_KEY || '',
  KYBER_BASE_URL: process.env.KYBER_BASE_URL || 'https://aggregator-api.kyberswap.com',
  UNI_QUOTE_URL: process.env.UNI_QUOTE_URL || '',
  COW_BASE_URL: process.env.COW_BASE_URL || 'https://api.cow.fi/mainnet',
  COW_API_KEY: process.env.COW_API_KEY || '',

  // Discovery hints
  EVM_TOP_TOKENS: (process.env.EVM_TOP_TOKENS || '').split(',').map(s=>s.trim()).filter(Boolean),
  EVM_TOKEN_ADDRS: (process.env.EVM_TOKEN_ADDRS || '').split(',').map(s=>s.trim()).filter(Boolean),

  // Consolidation
  CONSOLIDATE_ON: (process.env.CONSOLIDATE_ON || 'evm').toLowerCase(),
  CONSOLIDATE_SYMBOL: process.env.CONSOLIDATE_SYMBOL || 'USDC',
};

module.exports = cfg;
