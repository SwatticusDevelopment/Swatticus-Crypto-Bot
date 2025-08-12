// tools/debug-quote.js
require('dotenv').config();
const { ethers } = require('ethers');
const WETH = process.env.WETH_ADDRESS;
const USDC = process.env.USDC_ADDRESS;
const FEES = (process.env.UNI_V3_FEE_LIST || '500,3000,10000').split(',').map(s=>parseInt(s.trim(),10)).filter(n=>!isNaN(n));
const RPC  = process.env.EVM_RPC_URL;
const CHAIN_ID = parseInt(process.env.EVM_CHAIN_ID||'8453',10);
const QUOTER = process.env.UNI_V3_QUOTER;
const ROUTER = process.env.UNI_V3_ROUTER;
const FACTORY = process.env.UNI_V3_FACTORY || '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const QUOTER_V2_ABI = ['function quoteExactInputSingle((address,address,uint24,uint256,uint160)) view returns (uint256,uint160,uint32,uint256)'];
const QUOTER_V1_ABI = ['function quoteExactInputSingle(address,address,uint24,uint256,uint160) view returns (uint256)'];
const FACTORY_ABI = ['function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address)'];
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];
(async () => {
  const prov = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  const net = await prov.getNetwork();
  console.log('RPC/Network:', RPC, '->', net.chainId.toString());
  const [qCode, rCode] = await Promise.all([prov.getCode(QUOTER), prov.getCode(ROUTER)]);
  console.log('Quoter code bytes:', (qCode.length/2 - 1), 'Router code bytes:', (rCode.length/2 - 1));
  const amountIn = 1_000_000_000_000_000n;
  async function testPair(tokenA, tokenB, label){
    console.log(`\n=== Testing ${label}: ${tokenA} / ${tokenB} ===`);
    for (const fee of FEES){
      const factory = new ethers.Contract(FACTORY, FACTORY_ABI, prov);
      const pool = await factory.getPool(tokenA, tokenB, fee);
      console.log('fee', fee, 'pool', pool);
      if (pool && pool !== ethers.ZeroAddress){
        const p = new ethers.Contract(pool, POOL_ABI, prov);
        const [slot] = await p.slot0();
        console.log('slot0.sqrtPriceX96 =', slot.toString());
      }
      try {
        const q2 = new ethers.Contract(QUOTER, QUOTER_V2_ABI, prov);
        const [out] = await q2.quoteExactInputSingle.staticCall([tokenA, tokenB, fee, amountIn, 0], { gasLimit: 8_000_000 });
        console.log('QuoterV2 OK amountOut =', out.toString());
      } catch(e){ console.error('QuoterV2 err:', e.shortMessage || e.message); }
      try {
        const q1 = new ethers.Contract(QUOTER, QUOTER_V1_ABI, prov);
        const out = await q1.quoteExactInputSingle.staticCall(tokenA, tokenB, fee, amountIn, 0, { gasLimit: 8_000_000 });
        console.log('QuoterV1 OK amountOut =', out.toString());
      } catch(e){ console.error('QuoterV1 err:', e.shortMessage || e.message); }
    }
  }
  await testPair(WETH, USDC, 'WETH/USDC');
})().catch(e => { console.error('DEBUG FAIL', e); process.exit(1); });
