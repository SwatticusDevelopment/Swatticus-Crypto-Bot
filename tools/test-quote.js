// tools/test-quote.js
require('dotenv').config();
const { quoteUniV3 } = require('../src/js/onchainRouters');
(async () => {
  const out = await quoteUniV3(process.env.WETH_ADDRESS, process.env.USDC_ADDRESS, parseInt(process.env.UNI_V3_POOL_FEE||'500',10), BigInt(1e15));
  console.log('V3 quote (0.001 WETH -> USDC):', out.buyAmount, 'router:', out.router);
})().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
