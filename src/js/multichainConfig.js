// multichainConfig.js
module.exports = {
  USE_EVM: String(process.env.USE_EVM || 'true') === 'true',
  EVM_CHAIN: process.env.EVM_CHAIN || 'base',
  EVM_CHAIN_ID: parseInt(process.env.EVM_CHAIN_ID || '8453', 10),
  EVM_RPC_URL: process.env.EVM_RPC_URL || 'https://mainnet.base.org',
  EVM_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY || '',
  UNI_V3_FACTORY: process.env.UNI_V3_FACTORY || '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  UNI_V3_QUOTER: process.env.UNI_V3_QUOTER || '',
  UNI_V3_ROUTER: process.env.UNI_V3_ROUTER || '',
  UNI_V3_POOL_FEE: parseInt(process.env.UNI_V3_POOL_FEE || '500', 10),
  UNI_V3_FEE_LIST: (process.env.UNI_V3_FEE_LIST || '500,3000,10000'),
  UNI_V2_ROUTER: process.env.UNI_V2_ROUTER || '',
  UNI_V2_PATH: (process.env.UNI_V2_PATH || '').split(',').map(s=>s.trim()).filter(Boolean),
  WETH_ADDRESS: process.env.WETH_ADDRESS || '0x4200000000000000000000000000000000000006',
  USDC_ADDRESS: process.env.USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  ONCHAIN_ROUTERS: (process.env.ONCHAIN_ROUTERS || 'univ3')
};